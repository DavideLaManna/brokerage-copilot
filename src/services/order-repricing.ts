/**
 * Order Repricing Service
 *
 * Detects stale limit orders where the limit price is significantly
 * away from the current mid-price and proposes repricing to improve
 * fill probability. All repricing requires user approval before execution.
 *
 * Key features:
 * - Scans open orders for repricing opportunities
 * - Generates detailed proposals with rationale
 * - Stores proposals for user review
 * - Does NOT execute without explicit approval
 */

import { randomUUID } from 'crypto';
import type { BrokerAdapter, Order, Quote } from '../types/broker.js';
import type { AuditLogService } from './audit-log.js';
import type { MarketDataService } from './market-data.js';
import {
  calculateDeviationPercent,
  calculateProposedPrice,
  orderQualifiesForRepricing,
  orderQualifiesForAutoReprice,
  generateRepricingRationale,
  DEFAULT_REPRICING_CONFIG,
  REPRICING_SCHEMA_VERSION,
  type RepricingConfig,
  type RepricingProposal,
  type RepricingProposalStatus,
  type RepricingScanResult,
  type StoredRepricingProposal,
  type OrderModificationResult,
  type AutoRepriceResult,
  type AutoRepriceNotification,
  type RepricingSource,
} from '../types/repricing.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for the repricing service
 */
export interface RepricingServiceLogger {
  debug?: (message: string, data?: unknown) => void;
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
}

/**
 * Configuration for the repricing service
 */
export interface OrderRepricingServiceConfig {
  /** Repricing configuration */
  repricingConfig?: Partial<RepricingConfig>;
  /** Logger for debug output */
  logger?: RepricingServiceLogger;
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Order Repricing Service
 *
 * Scans open orders and generates repricing proposals for orders
 * where the limit price has drifted significantly from the current
 * market mid-price.
 */
export class OrderRepricingService {
  private adapter: BrokerAdapter;
  private marketDataService: MarketDataService;
  private auditLogService?: AuditLogService;
  private accountId: string;
  private config: RepricingConfig;
  private logger?: RepricingServiceLogger;

  // In-memory storage for proposals (per session)
  private proposals: Map<string, StoredRepricingProposal> = new Map();

  // Notifications for UI display
  private notifications: AutoRepriceNotification[] = [];

  // Track if auto-reprice has been disabled due to errors
  private autoRepriceDisabledReason?: string;

  constructor(
    adapter: BrokerAdapter,
    marketDataService: MarketDataService,
    accountId: string,
    config: OrderRepricingServiceConfig = {},
    auditLogService?: AuditLogService
  ) {
    this.adapter = adapter;
    this.marketDataService = marketDataService;
    this.auditLogService = auditLogService;
    this.accountId = accountId;
    this.config = { ...DEFAULT_REPRICING_CONFIG, ...config.repricingConfig };
    this.logger = config.logger;
  }

  /**
   * Scan all open orders for repricing opportunities
   *
   * @returns Scan result with generated proposals
   */
  async scanOpenOrders(): Promise<RepricingScanResult> {
    this.logger?.info?.('Starting order repricing scan', {
      accountId: this.accountId,
      config: this.config,
    });

    const now = new Date();
    const orders = await this.adapter.getOpenOrders();
    const proposals: RepricingProposal[] = [];
    const skipped: Array<{ orderId: string; symbol: string; reason: string }> = [];

    // Limit the number of orders to scan
    const ordersToScan = orders.slice(0, this.config.maxOrdersPerScan);

    for (const order of ordersToScan) {
      try {
        const proposal = await this.evaluateOrder(order, now);
        if (proposal) {
          proposals.push(proposal);
          // Store the proposal
          this.storeProposal(proposal);
        }
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Unknown error';
        skipped.push({
          orderId: order.id,
          symbol: order.symbol,
          reason,
        });
        this.logger?.warn?.('Error evaluating order for repricing', {
          orderId: order.id,
          symbol: order.symbol,
          error: reason,
        });
      }
    }

    // Find orders that were evaluated but didn't qualify
    const proposalOrderIds = new Set(proposals.map((p) => p.orderId));
    const skippedOrderIds = new Set(skipped.map((s) => s.orderId));

    for (const order of ordersToScan) {
      if (!proposalOrderIds.has(order.id) && !skippedOrderIds.has(order.id)) {
        // This order was evaluated but didn't generate a proposal
        // The reason should be captured during evaluation
        // Add a generic skip entry if not already present
        if (!skipped.some((s) => s.orderId === order.id)) {
          skipped.push({
            orderId: order.id,
            symbol: order.symbol,
            reason: 'Does not qualify for repricing',
          });
        }
      }
    }

    const result: RepricingScanResult = {
      ordersScanned: ordersToScan.length,
      ordersQualifying: proposals.length,
      proposals,
      skipped,
      scannedAt: now,
      configUsed: this.config,
    };

    this.logger?.info?.('Order repricing scan complete', {
      ordersScanned: result.ordersScanned,
      ordersQualifying: result.ordersQualifying,
      skippedCount: result.skipped.length,
    });

    return result;
  }

  /**
   * Evaluate a single order for repricing
   *
   * @param order - Order to evaluate
   * @param now - Current timestamp
   * @returns Repricing proposal if order qualifies, null otherwise
   */
  async evaluateOrder(
    order: Order,
    now: Date = new Date()
  ): Promise<RepricingProposal | null> {
    // Get current quote for the symbol
    const quote = await this.marketDataService.getQuote(order.symbol);

    // Calculate order age
    const orderAgeSeconds = Math.floor(
      (now.getTime() - order.submittedAt.getTime()) / 1000
    );

    // Check if order qualifies
    const qualification = orderQualifiesForRepricing(
      order,
      quote.mid,
      this.config,
      orderAgeSeconds
    );

    if (!qualification.qualifies) {
      this.logger?.debug?.('Order does not qualify for repricing', {
        orderId: order.id,
        symbol: order.symbol,
        reason: qualification.reason,
      });
      return null;
    }

    // Generate the proposal
    return this.generateProposal(order, quote, now);
  }

  /**
   * Generate a repricing proposal for an order
   *
   * @param order - Order to reprice
   * @param quote - Current market quote
   * @param now - Current timestamp
   * @param source - Source of the repricing (manual or auto)
   * @returns Generated repricing proposal
   */
  generateProposal(
    order: Order,
    quote: Quote,
    now: Date = new Date(),
    source: RepricingSource = 'manual'
  ): RepricingProposal {
    const deviationPercent = calculateDeviationPercent(
      order.limitPrice!,
      quote.mid
    );

    const proposedPrice = calculateProposedPrice(
      order.side,
      quote.mid,
      this.config.repriceBandPercent
    );

    // Round to appropriate precision (2 decimal places for most securities)
    const roundedProposedPrice = Math.round(proposedPrice * 100) / 100;

    // Calculate improvement
    const currentDistance = Math.abs(order.limitPrice! - quote.mid);
    const proposedDistance = Math.abs(roundedProposedPrice - quote.mid);
    const improvementPercent =
      quote.mid > 0
        ? ((currentDistance - proposedDistance) / quote.mid) * 100
        : 0;

    const rationale = generateRepricingRationale(
      order,
      quote.mid,
      roundedProposedPrice,
      deviationPercent,
      quote.bid,
      quote.ask
    );

    const proposal: RepricingProposal = {
      id: randomUUID(),
      accountId: this.accountId,
      orderId: order.id,
      symbol: order.symbol,
      assetClass: order.assetClass,
      side: order.side,
      currentLimitPrice: order.limitPrice!,
      currentMidPrice: quote.mid,
      currentBid: quote.bid,
      currentAsk: quote.ask,
      deviationPercent,
      proposedLimitPrice: roundedProposedPrice,
      improvementPercent,
      rationale,
      status: 'proposed',
      quantity: order.quantity,
      timeInForce: order.timeInForce,
      orderSubmittedAt: order.submittedAt,
      createdAt: now,
      updatedAt: now,
      source,
    };

    this.logger?.info?.('Generated repricing proposal', {
      proposalId: proposal.id,
      orderId: order.id,
      symbol: order.symbol,
      currentLimitPrice: proposal.currentLimitPrice,
      proposedLimitPrice: proposal.proposedLimitPrice,
      deviationPercent: proposal.deviationPercent,
    });

    return proposal;
  }

  /**
   * Store a proposal in the in-memory store
   */
  private storeProposal(proposal: RepricingProposal): void {
    const stored: StoredRepricingProposal = {
      ...proposal,
      version: REPRICING_SCHEMA_VERSION,
    };
    this.proposals.set(proposal.id, stored);
  }

  /**
   * Get a proposal by ID
   *
   * @param proposalId - Proposal ID to retrieve
   * @returns Proposal or null if not found
   */
  getProposal(proposalId: string): RepricingProposal | null {
    return this.proposals.get(proposalId) ?? null;
  }

  /**
   * Get all proposals with optional status filter
   *
   * @param status - Optional status filter
   * @returns Array of proposals
   */
  getProposals(status?: RepricingProposalStatus): RepricingProposal[] {
    const all = Array.from(this.proposals.values());
    if (status) {
      return all.filter((p) => p.status === status);
    }
    return all;
  }

  /**
   * Get pending proposals (awaiting user review)
   *
   * @returns Array of pending proposals
   */
  getPendingProposals(): RepricingProposal[] {
    return this.getProposals('proposed');
  }

  /**
   * Approve a repricing proposal
   *
   * This marks the proposal as approved but does NOT execute it.
   * Call executeProposal() to actually modify the order.
   *
   * @param proposalId - Proposal ID to approve
   * @returns Updated proposal or null if not found
   */
  async approveProposal(proposalId: string): Promise<RepricingProposal | null> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      this.logger?.warn?.('Proposal not found for approval', { proposalId });
      return null;
    }

    if (proposal.status !== 'proposed') {
      this.logger?.warn?.('Cannot approve proposal with status', {
        proposalId,
        status: proposal.status,
      });
      return null;
    }

    const now = new Date();
    proposal.status = 'approved';
    proposal.approvedAt = now;
    proposal.updatedAt = now;

    this.logger?.info?.('Proposal approved', {
      proposalId,
      orderId: proposal.orderId,
      symbol: proposal.symbol,
    });

    // Log to audit trail if available
    if (this.auditLogService) {
      await this.auditLogService.log({
        accountId: this.accountId,
        eventType: 'approval',
        actor: 'user',
        orderId: proposal.orderId,
        details: {
          type: 'approval',
          strategyType: 'order_reprice',
          underlying: proposal.symbol,
          orderCount: 1,
          estimatedCost: 0, // No cost change for repricing
          riskChecksPassed: true,
          warnings: [],
        },
        summary: `Approved repricing of ${proposal.symbol} from $${proposal.currentLimitPrice.toFixed(2)} to $${proposal.proposedLimitPrice.toFixed(2)}`,
      });
    }

    return proposal;
  }

  /**
   * Reject a repricing proposal
   *
   * @param proposalId - Proposal ID to reject
   * @param reason - Optional rejection reason
   * @returns Updated proposal or null if not found
   */
  async rejectProposal(
    proposalId: string,
    reason?: string
  ): Promise<RepricingProposal | null> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      this.logger?.warn?.('Proposal not found for rejection', { proposalId });
      return null;
    }

    if (proposal.status !== 'proposed' && proposal.status !== 'approved') {
      this.logger?.warn?.('Cannot reject proposal with status', {
        proposalId,
        status: proposal.status,
      });
      return null;
    }

    const now = new Date();
    proposal.status = 'rejected';
    proposal.rejectedAt = now;
    proposal.rejectionReason = reason;
    proposal.updatedAt = now;

    this.logger?.info?.('Proposal rejected', {
      proposalId,
      orderId: proposal.orderId,
      symbol: proposal.symbol,
      reason,
    });

    // Log to audit trail if available
    if (this.auditLogService) {
      await this.auditLogService.log({
        accountId: this.accountId,
        eventType: 'rejection',
        actor: 'user',
        orderId: proposal.orderId,
        details: {
          type: 'rejection',
          strategyType: 'order_reprice',
          underlying: proposal.symbol,
          reason,
          rejectedBy: 'user',
        },
        summary: `Rejected repricing of ${proposal.symbol}: ${reason || 'No reason provided'}`,
      });
    }

    return proposal;
  }

  /**
   * Execute a repricing proposal by modifying the order
   *
   * Note: Most brokers don't support in-place order modification.
   * This implementation cancels the original order and places a new one.
   *
   * @param proposalId - Proposal ID to execute
   * @returns Modification result
   */
  async executeProposal(proposalId: string): Promise<OrderModificationResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      return {
        success: false,
        originalOrderId: '',
        previousLimitPrice: 0,
        newLimitPrice: 0,
        errorMessage: 'Proposal not found',
        timestamp: new Date(),
      };
    }

    if (proposal.status !== 'approved') {
      return {
        success: false,
        originalOrderId: proposal.orderId,
        previousLimitPrice: proposal.currentLimitPrice,
        newLimitPrice: proposal.proposedLimitPrice,
        errorMessage: `Cannot execute proposal with status: ${proposal.status}`,
        timestamp: new Date(),
      };
    }

    const now = new Date();
    const result = await this.executeProposalInternal(proposal);

    if (result.success) {
      // Update proposal status
      proposal.status = 'executed';
      proposal.executedAt = now;
      proposal.newOrderId = result.newOrderId;
      proposal.updatedAt = now;

      this.logger?.info?.('Repricing executed successfully', {
        proposalId,
        originalOrderId: proposal.orderId,
        newOrderId: result.newOrderId,
        newLimitPrice: proposal.proposedLimitPrice,
        source: proposal.source,
      });

      // Log to audit trail if available
      if (this.auditLogService) {
        const prefix = proposal.source === 'auto_housekeeping' ? '[AUTO-HOUSEKEEPING] ' : '';
        await this.auditLogService.log({
          accountId: this.accountId,
          eventType: 'modification',
          actor: proposal.source === 'auto_housekeeping' ? 'system' : 'user',
          orderId: result.newOrderId!,
          details: {
            type: 'modification',
            symbol: proposal.symbol,
            brokerOrderId: proposal.orderId,
            modificationType: 'price',
            previousValue: proposal.currentLimitPrice,
            newValue: proposal.proposedLimitPrice,
            success: true,
          },
          summary: `${prefix}Repriced ${proposal.symbol} from $${proposal.currentLimitPrice.toFixed(2)} to $${proposal.proposedLimitPrice.toFixed(2)}`,
        });
      }
    } else {
      proposal.status = 'failed';
      proposal.errorMessage = result.errorMessage;
      proposal.updatedAt = now;

      // Log failure to audit trail if available
      if (this.auditLogService) {
        const prefix = proposal.source === 'auto_housekeeping' ? '[AUTO-HOUSEKEEPING] ' : '';
        await this.auditLogService.log({
          accountId: this.accountId,
          eventType: 'modification',
          actor: proposal.source === 'auto_housekeeping' ? 'system' : 'user',
          orderId: proposal.orderId,
          details: {
            type: 'modification',
            symbol: proposal.symbol,
            brokerOrderId: proposal.orderId,
            modificationType: 'price',
            previousValue: proposal.currentLimitPrice,
            newValue: proposal.proposedLimitPrice,
            success: false,
            errorMessage: result.errorMessage,
          },
          summary: `${prefix}Failed to reprice ${proposal.symbol}: ${result.errorMessage}`,
        });
      }
    }

    return result;
  }

  /**
   * Update the repricing configuration
   *
   * @param config - Partial config to update
   */
  updateConfig(config: Partial<RepricingConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger?.info?.('Repricing config updated', { config: this.config });
  }

  /**
   * Get the current configuration
   */
  getConfig(): RepricingConfig {
    return { ...this.config };
  }

  /**
   * Clear all stored proposals
   */
  clearProposals(): void {
    this.proposals.clear();
    this.logger?.info?.('All proposals cleared');
  }

  /**
   * Run automatic repricing scan
   *
   * If autoRepriceEnabled is true, this will:
   * 1. Scan open orders for repricing opportunities
   * 2. For orders within the autoRepriceBandPercent, automatically execute repricing
   * 3. For orders outside the band, generate proposals for manual review
   * 4. Disable auto-reprice if any validation fails
   *
   * @returns Auto-reprice result with success/failure details
   */
  async runAutoReprice(): Promise<AutoRepriceResult> {
    const resultId = randomUUID();
    const now = new Date();

    // Check if auto-reprice is enabled
    if (!this.config.autoRepriceEnabled) {
      return {
        id: resultId,
        timestamp: now,
        repriced: [],
        skipped: [],
        ordersScanned: 0,
        successCount: 0,
        failedCount: 0,
        autoRepriceStillEnabled: false,
        disabledReason: 'Auto-reprice is disabled in config',
      };
    }

    // Check if auto-reprice was previously disabled due to errors
    if (this.autoRepriceDisabledReason) {
      return {
        id: resultId,
        timestamp: now,
        repriced: [],
        skipped: [],
        ordersScanned: 0,
        successCount: 0,
        failedCount: 0,
        autoRepriceStillEnabled: false,
        disabledReason: this.autoRepriceDisabledReason,
      };
    }

    this.logger?.info?.('Starting auto-reprice scan', {
      accountId: this.accountId,
      autoRepriceBandPercent: this.config.autoRepriceBandPercent,
    });

    const orders = await this.adapter.getOpenOrders();
    const ordersToScan = orders.slice(0, this.config.maxOrdersPerScan);

    const repriced: AutoRepriceResult['repriced'] = [];
    const skipped: AutoRepriceResult['skipped'] = [];
    let successCount = 0;
    let failedCount = 0;
    let shouldDisableAutoReprice = false;
    let disableReason: string | undefined;

    for (const order of ordersToScan) {
      try {
        // Get quote for this order
        const quote = await this.marketDataService.getQuote(order.symbol);
        const orderAgeSeconds = Math.floor(
          (now.getTime() - order.submittedAt.getTime()) / 1000
        );

        // Check if order qualifies for any repricing
        const qualification = orderQualifiesForRepricing(
          order,
          quote.mid,
          this.config,
          orderAgeSeconds
        );

        if (!qualification.qualifies) {
          skipped.push({
            orderId: order.id,
            symbol: order.symbol,
            reason: qualification.reason || 'Does not qualify for repricing',
          });
          continue;
        }

        // Calculate proposed price
        const proposedPrice = calculateProposedPrice(
          order.side,
          quote.mid,
          this.config.repriceBandPercent
        );
        const roundedProposedPrice = Math.round(proposedPrice * 100) / 100;

        // Calculate the deviation of the proposed price from mid
        const proposedDeviationPercent = Math.abs(
          calculateDeviationPercent(roundedProposedPrice, quote.mid)
        );
        const currentDeviationPercent = Math.abs(
          calculateDeviationPercent(order.limitPrice!, quote.mid)
        );

        // Check if this qualifies for AUTO repricing (more conservative)
        const qualifiesForAuto = orderQualifiesForAutoReprice(
          currentDeviationPercent,
          proposedDeviationPercent,
          this.config.autoRepriceBandPercent
        );

        if (!qualifiesForAuto) {
          // Generate a manual proposal instead
          const proposal = this.generateProposal(order, quote, now, 'manual');
          this.storeProposal(proposal);
          skipped.push({
            orderId: order.id,
            symbol: order.symbol,
            reason: `Proposed price ${proposedDeviationPercent.toFixed(1)}% from mid exceeds auto-reprice band ${this.config.autoRepriceBandPercent}%`,
          });
          continue;
        }

        // Generate auto-reprice proposal
        const proposal = this.generateProposal(order, quote, now, 'auto_housekeeping');
        proposal.autoExecuted = true;
        this.storeProposal(proposal);

        // Get stored proposal (which has version)
        const storedProposal = this.proposals.get(proposal.id)!;

        // Auto-approve and execute
        storedProposal.status = 'approved';
        storedProposal.approvedAt = now;
        storedProposal.updatedAt = now;

        const result = await this.executeProposalInternal(storedProposal);

        if (result.success) {
          storedProposal.status = 'executed';
          storedProposal.executedAt = new Date();
          storedProposal.newOrderId = result.newOrderId;
          successCount++;
          repriced.push({
            orderId: order.id,
            symbol: order.symbol,
            previousPrice: order.limitPrice!,
            newPrice: roundedProposedPrice,
            newOrderId: result.newOrderId,
            success: true,
          });

          // Log auto-reprice to audit trail
          await this.logAutoRepriceAction(storedProposal, result, 'auto_housekeeping');
        } else {
          storedProposal.status = 'failed';
          storedProposal.errorMessage = result.errorMessage;
          failedCount++;
          repriced.push({
            orderId: order.id,
            symbol: order.symbol,
            previousPrice: order.limitPrice!,
            newPrice: roundedProposedPrice,
            success: false,
            errorMessage: result.errorMessage,
          });

          // Check if we should disable auto-reprice due to failures
          if (this.shouldDisableAutoRepriceOnError(result.errorMessage)) {
            shouldDisableAutoReprice = true;
            disableReason = `Auto-reprice disabled: ${result.errorMessage}`;
          }
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        skipped.push({
          orderId: order.id,
          symbol: order.symbol,
          reason: `Error: ${errorMessage}`,
        });

        // Check if this error should disable auto-reprice
        if (this.shouldDisableAutoRepriceOnError(errorMessage)) {
          shouldDisableAutoReprice = true;
          disableReason = `Auto-reprice disabled: ${errorMessage}`;
        }
      }
    }

    // Disable auto-reprice if needed
    if (shouldDisableAutoReprice && disableReason) {
      this.disableAutoReprice(disableReason);
    }

    const result: AutoRepriceResult = {
      id: resultId,
      timestamp: now,
      repriced,
      skipped,
      ordersScanned: ordersToScan.length,
      successCount,
      failedCount,
      autoRepriceStillEnabled: !shouldDisableAutoReprice && this.config.autoRepriceEnabled,
      disabledReason: shouldDisableAutoReprice ? disableReason : undefined,
    };

    // Generate notification for UI
    this.generateAutoRepriceNotification(result);

    this.logger?.info?.('Auto-reprice scan complete', {
      ordersScanned: result.ordersScanned,
      successCount,
      failedCount,
      skippedCount: skipped.length,
      autoRepriceStillEnabled: result.autoRepriceStillEnabled,
    });

    return result;
  }

  /**
   * Internal method to execute a proposal (used by both manual and auto execution)
   */
  private async executeProposalInternal(
    proposal: StoredRepricingProposal
  ): Promise<OrderModificationResult> {
    const now = new Date();

    try {
      // Step 1: Cancel the original order
      this.logger?.info?.('Canceling original order for repricing', {
        orderId: proposal.orderId,
        symbol: proposal.symbol,
        source: proposal.source,
      });

      const cancelSuccess = await this.adapter.cancelOrder(proposal.orderId);
      if (!cancelSuccess) {
        throw new Error('Failed to cancel original order');
      }

      // Step 2: Place a new order with the proposed price
      this.logger?.info?.('Placing new order with updated price', {
        symbol: proposal.symbol,
        newLimitPrice: proposal.proposedLimitPrice,
        source: proposal.source,
      });

      // Get the original order details
      const originalOrder = await this.adapter.getOrder(proposal.orderId);

      // Build the new order request
      const newOrder = await this.adapter.placeOrder(
        {
          symbol: proposal.symbol,
          assetClass: proposal.assetClass,
          side: proposal.side,
          orderType: 'limit',
          timeInForce: proposal.timeInForce,
          quantity: proposal.quantity,
          limitPrice: proposal.proposedLimitPrice,
          optionDetails: originalOrder?.optionDetails
            ? {
                underlying: originalOrder.optionDetails.underlying,
                strike: originalOrder.optionDetails.strike,
                expiration: originalOrder.optionDetails.expiration,
                optionType: originalOrder.optionDetails.optionType,
              }
            : undefined,
        },
        randomUUID()
      );

      return {
        success: true,
        originalOrderId: proposal.orderId,
        newOrderId: newOrder.id,
        previousLimitPrice: proposal.currentLimitPrice,
        newLimitPrice: proposal.proposedLimitPrice,
        timestamp: now,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger?.error?.('Failed to execute repricing', {
        proposalId: proposal.id,
        orderId: proposal.orderId,
        source: proposal.source,
        error: errorMessage,
      });

      return {
        success: false,
        originalOrderId: proposal.orderId,
        previousLimitPrice: proposal.currentLimitPrice,
        newLimitPrice: proposal.proposedLimitPrice,
        errorMessage,
        timestamp: now,
      };
    }
  }

  /**
   * Log an auto-reprice action to the audit trail
   */
  private async logAutoRepriceAction(
    proposal: RepricingProposal,
    result: OrderModificationResult,
    source: RepricingSource
  ): Promise<void> {
    if (!this.auditLogService) return;

    await this.auditLogService.log({
      accountId: this.accountId,
      eventType: 'modification',
      actor: 'system',
      orderId: result.newOrderId || proposal.orderId,
      details: {
        type: 'modification',
        symbol: proposal.symbol,
        brokerOrderId: proposal.orderId,
        modificationType: 'price',
        previousValue: proposal.currentLimitPrice,
        newValue: proposal.proposedLimitPrice,
        success: result.success,
        errorMessage: result.errorMessage,
      },
      summary: `[AUTO-HOUSEKEEPING] ${result.success ? 'Repriced' : 'Failed to reprice'} ${proposal.symbol} from $${proposal.currentLimitPrice.toFixed(2)} to $${proposal.proposedLimitPrice.toFixed(2)}`,
    });
  }

  /**
   * Check if an error should disable auto-reprice
   */
  private shouldDisableAutoRepriceOnError(errorMessage?: string): boolean {
    if (!errorMessage) return false;

    // Errors that should disable auto-reprice for safety
    const disableOnErrors = [
      'authentication',
      'unauthorized',
      'rate limit',
      'insufficient',
      'buying power',
      'margin',
      'account restricted',
      'account blocked',
      'permission denied',
    ];

    const lowerError = errorMessage.toLowerCase();
    return disableOnErrors.some((pattern) => lowerError.includes(pattern));
  }

  /**
   * Disable auto-reprice and record the reason
   */
  disableAutoReprice(reason: string): void {
    this.config.autoRepriceEnabled = false;
    this.autoRepriceDisabledReason = reason;
    this.logger?.warn?.('Auto-reprice disabled', { reason });

    // Log config change to audit trail
    if (this.auditLogService) {
      this.auditLogService.log({
        accountId: this.accountId,
        eventType: 'config_change',
        actor: 'system',
        details: {
          type: 'config_change',
          configType: 'auto_reprice',
          field: 'autoRepriceEnabled',
          previousValue: true,
          newValue: false,
        },
        summary: `[AUTO-HOUSEKEEPING] Auto-reprice disabled: ${reason}`,
      }).catch((err) => {
        this.logger?.error?.('Failed to log auto-reprice disable', { error: err });
      });
    }

    // Generate notification
    this.addNotification({
      id: randomUUID(),
      type: 'warning',
      title: 'Auto-Reprice Disabled',
      message: reason,
      orderIds: [],
      symbols: [],
      timestamp: new Date(),
      dismissed: false,
    });
  }

  /**
   * Re-enable auto-reprice after it was disabled
   */
  enableAutoReprice(): void {
    if (this.config.autoRepriceEnabled && !this.autoRepriceDisabledReason) {
      return; // Already enabled
    }

    this.config.autoRepriceEnabled = true;
    this.autoRepriceDisabledReason = undefined;
    this.logger?.info?.('Auto-reprice re-enabled');

    // Log config change to audit trail
    if (this.auditLogService) {
      this.auditLogService.log({
        accountId: this.accountId,
        eventType: 'config_change',
        actor: 'user',
        details: {
          type: 'config_change',
          configType: 'auto_reprice',
          field: 'autoRepriceEnabled',
          previousValue: false,
          newValue: true,
        },
        summary: 'Auto-reprice re-enabled by user',
      }).catch((err) => {
        this.logger?.error?.('Failed to log auto-reprice enable', { error: err });
      });
    }

    // Generate notification
    this.addNotification({
      id: randomUUID(),
      type: 'info',
      title: 'Auto-Reprice Enabled',
      message: 'Automatic repricing is now active',
      orderIds: [],
      symbols: [],
      timestamp: new Date(),
      dismissed: false,
    });
  }

  /**
   * Check if auto-reprice is currently available
   */
  isAutoRepriceAvailable(): { available: boolean; reason?: string } {
    // Check disabled reason first - this provides more context than just "disabled in config"
    if (this.autoRepriceDisabledReason) {
      return { available: false, reason: this.autoRepriceDisabledReason };
    }
    if (!this.config.autoRepriceEnabled) {
      return { available: false, reason: 'Auto-reprice is disabled in config' };
    }
    return { available: true };
  }

  /**
   * Generate notification from auto-reprice result
   */
  private generateAutoRepriceNotification(result: AutoRepriceResult): void {
    if (result.repriced.length === 0 && result.skipped.length === 0) {
      return; // No activity to notify about
    }

    const symbols = [...new Set(result.repriced.map((r) => r.symbol))];
    const orderIds = result.repriced.map((r) => r.orderId);

    let type: AutoRepriceNotification['type'];
    let title: string;
    let message: string;

    if (result.failedCount > 0 && result.successCount === 0) {
      type = 'error';
      title = 'Auto-Reprice Failed';
      message = `Failed to reprice ${result.failedCount} order(s)`;
    } else if (result.failedCount > 0) {
      type = 'warning';
      title = 'Auto-Reprice Partial Success';
      message = `Repriced ${result.successCount} order(s), ${result.failedCount} failed`;
    } else if (result.successCount > 0) {
      type = 'success';
      title = 'Auto-Reprice Complete';
      message = `Successfully repriced ${result.successCount} order(s)`;
    } else {
      type = 'info';
      title = 'Auto-Reprice Scan';
      message = `Scanned ${result.ordersScanned} orders, ${result.skipped.length} skipped`;
    }

    if (!result.autoRepriceStillEnabled && result.disabledReason) {
      message += `. Auto-reprice disabled: ${result.disabledReason}`;
      type = 'warning';
    }

    this.addNotification({
      id: randomUUID(),
      type,
      title,
      message,
      orderIds,
      symbols,
      timestamp: result.timestamp,
      dismissed: false,
      result,
    });
  }

  /**
   * Add a notification
   */
  private addNotification(notification: AutoRepriceNotification): void {
    this.notifications.push(notification);

    // Keep only the last 50 notifications
    if (this.notifications.length > 50) {
      this.notifications = this.notifications.slice(-50);
    }
  }

  /**
   * Get all notifications
   */
  getNotifications(): AutoRepriceNotification[] {
    return [...this.notifications];
  }

  /**
   * Get undismissed notifications
   */
  getActiveNotifications(): AutoRepriceNotification[] {
    return this.notifications.filter((n) => !n.dismissed);
  }

  /**
   * Dismiss a notification
   */
  dismissNotification(notificationId: string): boolean {
    const notification = this.notifications.find((n) => n.id === notificationId);
    if (notification) {
      notification.dismissed = true;
      return true;
    }
    return false;
  }

  /**
   * Dismiss all notifications
   */
  dismissAllNotifications(): void {
    this.notifications.forEach((n) => (n.dismissed = true));
  }

  /**
   * Clear all notifications
   */
  clearNotifications(): void {
    this.notifications = [];
  }

  /**
   * Get statistics about proposals
   */
  getStatistics(): {
    total: number;
    proposed: number;
    approved: number;
    rejected: number;
    executed: number;
    failed: number;
    expired: number;
  } {
    const proposals = Array.from(this.proposals.values());
    return {
      total: proposals.length,
      proposed: proposals.filter((p) => p.status === 'proposed').length,
      approved: proposals.filter((p) => p.status === 'approved').length,
      rejected: proposals.filter((p) => p.status === 'rejected').length,
      executed: proposals.filter((p) => p.status === 'executed').length,
      failed: proposals.filter((p) => p.status === 'failed').length,
      expired: proposals.filter((p) => p.status === 'expired').length,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an OrderRepricingService
 *
 * @param adapter - Broker adapter
 * @param marketDataService - Market data service for quotes
 * @param accountId - Account ID
 * @param config - Optional configuration
 * @param auditLogService - Optional audit log service
 * @returns Configured OrderRepricingService
 */
export function createOrderRepricingService(
  adapter: BrokerAdapter,
  marketDataService: MarketDataService,
  accountId: string,
  config?: OrderRepricingServiceConfig,
  auditLogService?: AuditLogService
): OrderRepricingService {
  return new OrderRepricingService(
    adapter,
    marketDataService,
    accountId,
    config,
    auditLogService
  );
}

// ============================================================================
// Standalone Functions
// ============================================================================

/**
 * Evaluate a single order for repricing without using the full service
 *
 * @param order - Order to evaluate
 * @param quote - Current market quote
 * @param config - Repricing configuration
 * @param accountId - Account ID
 * @param source - Source of the repricing (manual or auto)
 * @returns Repricing proposal if order qualifies, null otherwise
 */
export function evaluateOrderForRepricing(
  order: Order,
  quote: Quote,
  config: RepricingConfig = DEFAULT_REPRICING_CONFIG,
  accountId: string = 'default',
  source: RepricingSource = 'manual'
): RepricingProposal | null {
  const now = new Date();
  const orderAgeSeconds = Math.floor(
    (now.getTime() - order.submittedAt.getTime()) / 1000
  );

  const qualification = orderQualifiesForRepricing(
    order,
    quote.mid,
    config,
    orderAgeSeconds
  );

  if (!qualification.qualifies) {
    return null;
  }

  const deviationPercent = calculateDeviationPercent(
    order.limitPrice!,
    quote.mid
  );

  const proposedPrice = calculateProposedPrice(
    order.side,
    quote.mid,
    config.repriceBandPercent
  );

  const roundedProposedPrice = Math.round(proposedPrice * 100) / 100;

  const currentDistance = Math.abs(order.limitPrice! - quote.mid);
  const proposedDistance = Math.abs(roundedProposedPrice - quote.mid);
  const improvementPercent =
    quote.mid > 0
      ? ((currentDistance - proposedDistance) / quote.mid) * 100
      : 0;

  const rationale = generateRepricingRationale(
    order,
    quote.mid,
    roundedProposedPrice,
    deviationPercent,
    quote.bid,
    quote.ask
  );

  return {
    id: randomUUID(),
    accountId,
    orderId: order.id,
    symbol: order.symbol,
    assetClass: order.assetClass,
    side: order.side,
    currentLimitPrice: order.limitPrice!,
    currentMidPrice: quote.mid,
    currentBid: quote.bid,
    currentAsk: quote.ask,
    deviationPercent,
    proposedLimitPrice: roundedProposedPrice,
    improvementPercent,
    rationale,
    status: 'proposed',
    quantity: order.quantity,
    timeInForce: order.timeInForce,
    orderSubmittedAt: order.submittedAt,
    createdAt: now,
    updatedAt: now,
    source,
  };
}
