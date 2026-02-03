/**
 * Alert Action Proposals Service
 *
 * Generates TradeProposals from alert events. When an alert fires,
 * this service analyzes the situation and creates a pre-built order
 * ready for one-click approval.
 *
 * Key features:
 * - Converts alert recommended actions to concrete TradeProposals
 * - Supports trim, exit, and hedge strategies
 * - Tags proposals as alert-driven in audit log
 * - One-click approval flow integration
 */

import { randomUUID } from 'crypto';
import type { BrokerAdapter, Position, OptionDetails, Quote } from '../types/broker.js';
import type { MarketDataService } from './market-data.js';
import type { TradeProposalService } from './trade-proposal.js';
import type { AuditLogService } from './audit-log.js';
import type {
  AlertEvent,
  AlertRecommendedAction,
  AlertTriggerType,
  AlertContext,
} from '../types/alerts.js';
import {
  type TradeProposal,
  type StoredTradeProposal,
  type ProposalContract,
  type StrategyType,
  type ConfidenceLevel,
  type DataSource,
} from '../types/trade-proposal.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the alert action proposals service
 */
export interface AlertActionProposalsConfig {
  /** Default percentage to close on exit action (default: 100) */
  defaultExitPercent?: number;
  /** Default percentage to close on trim action (default: 50) */
  defaultTrimPercent?: number;
  /** Default time in force for generated orders */
  defaultTimeInForce?: 'day' | 'gtc';
  /** Default order type for generated orders */
  defaultOrderType?: 'limit' | 'market';
  /** Slippage percentage for limit orders (default: 1) */
  slippagePercent?: number;
}

/**
 * Result of generating a proposal from an alert
 */
export interface AlertProposalResult {
  /** Whether proposal was successfully generated */
  success: boolean;
  /** The generated proposal (if successful) */
  proposal?: StoredTradeProposal;
  /** Error message (if not successful) */
  error?: string;
  /** The alert ID this proposal is for */
  alertId: string;
  /** The action that triggered the proposal */
  action: AlertRecommendedAction;
  /** Timestamp of generation */
  generatedAt: Date;
}

/**
 * An alert with its generated proposal(s)
 */
export interface AlertWithProposals {
  /** The original alert event */
  alert: AlertEvent;
  /** Generated proposals for each recommended action */
  proposals: AlertProposalResult[];
  /** Correlation ID linking alert to proposals */
  correlationId: string;
}

/**
 * Options for generating a proposal
 */
export interface GenerateProposalOptions {
  /** Override the default close percentage */
  closePercent?: number;
  /** Override the default order type */
  orderType?: 'limit' | 'market';
  /** Additional notes for the proposal */
  notes?: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: Required<AlertActionProposalsConfig> = {
  defaultExitPercent: 100,
  defaultTrimPercent: 50,
  defaultTimeInForce: 'day',
  defaultOrderType: 'limit',
  slippagePercent: 1,
};

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Alert Action Proposals Service
 *
 * Generates trade proposals from alert events, enabling one-click
 * approval for recommended actions.
 */
export class AlertActionProposalsService {
  private adapter: BrokerAdapter;
  private marketDataService: MarketDataService;
  private tradeProposalService: TradeProposalService;
  private auditLogService?: AuditLogService;
  private accountId: string;
  private config: Required<AlertActionProposalsConfig>;

  // In-memory storage for alert-proposal associations
  private alertProposals: Map<string, AlertWithProposals> = new Map();

  constructor(
    adapter: BrokerAdapter,
    marketDataService: MarketDataService,
    tradeProposalService: TradeProposalService,
    accountId: string,
    config: AlertActionProposalsConfig = {},
    auditLogService?: AuditLogService
  ) {
    this.adapter = adapter;
    this.marketDataService = marketDataService;
    this.tradeProposalService = tradeProposalService;
    this.auditLogService = auditLogService;
    this.accountId = accountId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Main Methods
  // ============================================================================

  /**
   * Generate proposals for an alert event
   *
   * Analyzes the alert and creates TradeProposals for each actionable
   * recommended action (trim, exit, hedge).
   */
  async generateProposalsForAlert(
    alert: AlertEvent,
    options?: GenerateProposalOptions
  ): Promise<AlertWithProposals> {
    const correlationId = randomUUID();
    const proposals: AlertProposalResult[] = [];

    // Get actionable recommendations (skip 'hold' and 'monitor')
    const actionableActions = alert.recommendedActions.filter(
      (action) => action.action === 'trim' || action.action === 'exit' || action.action === 'hedge'
    );

    for (const action of actionableActions) {
      const result = await this.generateProposalForAction(alert, action, correlationId, options);
      proposals.push(result);
    }

    const alertWithProposals: AlertWithProposals = {
      alert,
      proposals,
      correlationId,
    };

    // Store the association
    this.alertProposals.set(alert.id, alertWithProposals);

    // Log to audit trail
    if (this.auditLogService && proposals.some((p) => p.success)) {
      const successfulProposals = proposals.filter((p) => p.success && p.proposal);

      this.auditLogService.log({
        eventType: 'recommendation',
        actor: 'agent',
        accountId: this.accountId,
        correlationId,
        details: {
          type: 'recommendation',
          strategyType: this.determineStrategyTypeFromAlert(alert),
          underlying: this.getUnderlyingFromAlert(alert),
          confidence: this.mapSeverityToConfidence(alert.severity),
          thesis: [
            `Alert-driven recommendation: ${alert.title}`,
            alert.message,
          ],
          catalysts: actionableActions.map((a) => `${a.action}: ${a.rationale}`),
          contractCount: successfulProposals.reduce(
            (sum, p) => sum + (p.proposal?.proposal.contracts.length ?? 0),
            0
          ),
        },
        dataSources: [
          {
            sourceType: 'market_data',
            description: `Alert trigger: ${alert.triggerType}`,
            retrievedAt: alert.triggeredAt.toISOString(),
            reference: `alert:${alert.id}`,
          },
        ],
        summary: `Generated ${successfulProposals.length} proposal(s) from alert: ${alert.title}`,
      });
    }

    return alertWithProposals;
  }

  /**
   * Generate a proposal for a specific action
   */
  async generateProposalForAction(
    alert: AlertEvent,
    action: AlertRecommendedAction,
    correlationId: string,
    options?: GenerateProposalOptions
  ): Promise<AlertProposalResult> {
    const now = new Date();

    try {
      // Determine the position(s) affected
      const positions = await this.getAffectedPositions(alert, action);

      if (positions.length === 0) {
        return {
          success: false,
          error: 'No positions found for this action',
          alertId: alert.id,
          action,
          generatedAt: now,
        };
      }

      // Generate proposal based on action type
      let proposal: TradeProposal | null = null;

      switch (action.action) {
        case 'exit':
          proposal = await this.buildExitProposal(
            alert,
            action,
            positions,
            options?.closePercent ?? this.config.defaultExitPercent,
            options
          );
          break;

        case 'trim':
          proposal = await this.buildTrimProposal(
            alert,
            action,
            positions,
            options?.closePercent ?? this.config.defaultTrimPercent,
            options
          );
          break;

        case 'hedge':
          proposal = await this.buildHedgeProposal(alert, action, positions, options);
          break;

        default:
          return {
            success: false,
            error: `Unsupported action type: ${action.action}`,
            alertId: alert.id,
            action,
            generatedAt: now,
          };
      }

      if (!proposal) {
        return {
          success: false,
          error: 'Failed to build proposal',
          alertId: alert.id,
          action,
          generatedAt: now,
        };
      }

      // Store the proposal
      const storedProposal = await this.tradeProposalService.createProposal(
        this.accountId,
        proposal,
        {
          createdBy: `alert:${alert.id}`,
          status: 'draft',
          notes: `Alert-driven proposal: ${alert.title}\nAction: ${action.action}\nRationale: ${action.rationale}`,
        }
      );

      return {
        success: true,
        proposal: storedProposal,
        alertId: alert.id,
        action,
        generatedAt: now,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: errorMessage,
        alertId: alert.id,
        action,
        generatedAt: now,
      };
    }
  }

  /**
   * Get proposals for a specific alert
   */
  getProposalsForAlert(alertId: string): AlertWithProposals | undefined {
    return this.alertProposals.get(alertId);
  }

  /**
   * Get all alert-proposal associations
   */
  getAllAlertProposals(): AlertWithProposals[] {
    return Array.from(this.alertProposals.values());
  }

  /**
   * Clear proposals for an alert (e.g., when alert is dismissed)
   */
  clearProposalsForAlert(alertId: string): boolean {
    return this.alertProposals.delete(alertId);
  }

  // ============================================================================
  // Proposal Building
  // ============================================================================

  /**
   * Build an exit proposal (close entire position)
   */
  private async buildExitProposal(
    alert: AlertEvent,
    action: AlertRecommendedAction,
    positions: Position[],
    closePercent: number,
    options?: GenerateProposalOptions
  ): Promise<TradeProposal | null> {
    const contracts: ProposalContract[] = [];
    let totalValue = 0;

    for (const position of positions) {
      const contractsToClose = Math.max(
        1,
        Math.floor((Math.abs(position.quantity) * closePercent) / 100)
      );

      // Get current quote for limit price
      const quote = await this.marketDataService.getQuote(position.symbol);
      const targetPrice = this.calculateTargetPrice(
        quote,
        position.quantity > 0 ? 'sell' : 'buy',
        options?.orderType ?? this.config.defaultOrderType
      );

      // Build contract from position
      const contract = this.buildContractFromPosition(
        position,
        contractsToClose,
        targetPrice
      );

      if (contract) {
        contracts.push(contract);
        totalValue += targetPrice * contractsToClose * 100; // Options multiplier
      }
    }

    if (contracts.length === 0) {
      return null;
    }

    const underlying = this.getUnderlyingFromAlert(alert);

    return {
      strategyType: this.determineExitStrategy(positions),
      underlying,
      contracts,
      thesis: [
        `Alert-triggered exit: ${alert.title}`,
        action.rationale,
        `Closing ${closePercent}% of position(s)`,
      ],
      catalysts: [
        `${this.formatTriggerType(alert.triggerType)} triggered`,
        ...this.extractCatalystsFromContext(alert.context),
      ],
      entryPlan: {
        orderType: options?.orderType ?? this.config.defaultOrderType,
        limitPrice: contracts.length === 1 ? contracts[0]!.targetPrice : undefined,
        slippagePercent: this.config.slippagePercent,
        timeInForce: this.config.defaultTimeInForce,
        entryConditions: `Execute immediately - alert-driven action`,
      },
      exitPlan: {
        profitTargets: [{ percentGain: 0, closePercent: 100 }], // Close now
      },
      risk: {
        maxLoss: 0, // Exit reduces risk
        riskNotes: `Exiting position to reduce risk following alert: ${alert.title}`,
      },
      confidence: this.mapSeverityToConfidence(alert.severity),
      dataUsed: this.buildDataSources(alert),
    };
  }

  /**
   * Build a trim proposal (close partial position)
   */
  private async buildTrimProposal(
    alert: AlertEvent,
    action: AlertRecommendedAction,
    positions: Position[],
    closePercent: number,
    options?: GenerateProposalOptions
  ): Promise<TradeProposal | null> {
    // Trim is essentially a partial exit
    return this.buildExitProposal(alert, action, positions, closePercent, options);
  }

  /**
   * Build a hedge proposal (add protective position)
   */
  private async buildHedgeProposal(
    alert: AlertEvent,
    action: AlertRecommendedAction,
    positions: Position[],
    options?: GenerateProposalOptions
  ): Promise<TradeProposal | null> {
    // For hedging, we need to determine the underlying and build a protective position
    const underlying = this.getUnderlyingFromAlert(alert);

    // Get the underlying quote
    const quote = await this.marketDataService.getQuote(underlying);

    // Calculate hedge size based on position value
    const totalPositionValue = positions.reduce(
      (sum, p) => sum + Math.abs(p.marketValue),
      0
    );

    // Determine if we need protective puts or calls
    const netDelta = this.estimateNetDelta(positions);
    const needPuts = netDelta > 0; // Long delta, buy puts to hedge

    // Try to get option chain for hedge
    try {
      const chain = await this.marketDataService.getOptionChain({
        symbol: underlying,
        minDTE: 7,
        maxDTE: 45,
      });

      if (!chain.expirations || chain.expirations.length === 0) {
        return null;
      }

      // Find nearest expiration
      const nearestExpiration = chain.expirations[0];
      if (!nearestExpiration) {
        return null;
      }

      // Get contracts for this expiration
      const expirationKey = nearestExpiration instanceof Date
        ? nearestExpiration.toISOString().split('T')[0]!
        : nearestExpiration;
      const allContracts = chain.contracts.get(expirationKey);

      if (!allContracts || allContracts.length === 0) {
        return null;
      }

      // Filter by option type (puts or calls)
      const contracts = allContracts.filter(
        (c) => c.optionType === (needPuts ? 'put' : 'call')
      );

      if (contracts.length === 0) {
        return null;
      }

      // Find OTM strike for hedge (5% OTM)
      const targetStrike = needPuts
        ? quote.last * 0.95 // Put 5% below current
        : quote.last * 1.05; // Call 5% above current

      // Find closest strike
      const hedgeContract = contracts.reduce((closest, contract) => {
        const closestDiff = Math.abs(closest.strike - targetStrike);
        const currentDiff = Math.abs(contract.strike - targetStrike);
        return currentDiff < closestDiff ? contract : closest;
      });

      if (!hedgeContract) {
        return null;
      }

      // Calculate number of contracts for hedge
      const hedgeValue = totalPositionValue * 0.1; // 10% of position value
      const contractCost = ((hedgeContract.ask + hedgeContract.bid) / 2) * 100;
      const numContracts = Math.max(1, Math.floor(hedgeValue / contractCost));

      const proposalContract: ProposalContract = {
        optionSymbol: hedgeContract.optionSymbol,
        underlying,
        strike: hedgeContract.strike,
        expiration: hedgeContract.expiration instanceof Date
          ? hedgeContract.expiration
          : new Date(hedgeContract.expiration),
        optionType: needPuts ? 'put' : 'call',
        side: 'buy',
        quantity: numContracts,
        targetPrice: hedgeContract.ask, // Pay the ask for immediate execution
      };

      return {
        strategyType: needPuts ? 'long_put' : 'long_call',
        underlying,
        contracts: [proposalContract],
        thesis: [
          `Alert-triggered hedge: ${alert.title}`,
          action.rationale,
          `Adding protective ${needPuts ? 'puts' : 'calls'} to reduce portfolio risk`,
        ],
        catalysts: [
          `${this.formatTriggerType(alert.triggerType)} triggered`,
          ...this.extractCatalystsFromContext(alert.context),
        ],
        entryPlan: {
          orderType: options?.orderType ?? this.config.defaultOrderType,
          limitPrice: proposalContract.targetPrice,
          slippagePercent: this.config.slippagePercent,
          timeInForce: this.config.defaultTimeInForce,
          entryConditions: `Execute promptly - protective hedge`,
        },
        exitPlan: {
          profitTargets: [{ percentGain: 50, closePercent: 50 }, { percentGain: 100, closePercent: 50 }],
          stopLoss: { type: 'percent', value: 50 },
          maxHoldDays: 30,
        },
        risk: {
          maxLoss: proposalContract.targetPrice! * numContracts * 100,
          maxLossPercent: (proposalContract.targetPrice! * numContracts * 100 / totalPositionValue) * 100,
          riskNotes: `Hedge premium is the maximum loss if position expires worthless`,
        },
        confidence: this.mapSeverityToConfidence(alert.severity),
        dataUsed: this.buildDataSources(alert),
      };
    } catch {
      // If we can't get option chain, return null
      return null;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get positions affected by the alert/action
   */
  private async getAffectedPositions(
    alert: AlertEvent,
    action: AlertRecommendedAction
  ): Promise<Position[]> {
    const allPositions = await this.adapter.getPositions();

    // If action specifies position IDs, use those
    if (action.positionIds && action.positionIds.length > 0) {
      return allPositions.filter((p) => action.positionIds!.includes(p.id));
    }

    // If action specifies symbols, filter by those
    if (action.symbols && action.symbols.length > 0) {
      return allPositions.filter((p) => {
        const underlying = this.getPositionUnderlying(p);
        return action.symbols.includes(p.symbol) || action.symbols.includes(underlying);
      });
    }

    // For portfolio-level alerts (drawdown), return all positions
    if (alert.triggerType === 'portfolio_drawdown') {
      return allPositions;
    }

    // If alert context has position info, use that symbol
    if (alert.context.position?.symbol) {
      return allPositions.filter(
        (p) => p.symbol === alert.context.position!.symbol
      );
    }

    return [];
  }

  /**
   * Build contract from existing position
   */
  private buildContractFromPosition(
    position: Position,
    quantity: number,
    targetPrice: number
  ): ProposalContract | null {
    // Extract option details from position
    const optionDetails = position.optionDetails;

    if (position.assetClass === 'option' && optionDetails) {
      return {
        optionSymbol: position.symbol,
        underlying: optionDetails.underlying,
        strike: optionDetails.strike,
        expiration: new Date(optionDetails.expiration),
        optionType: optionDetails.optionType,
        side: position.quantity > 0 ? 'sell' : 'buy', // Close the position
        quantity,
        targetPrice,
      };
    }

    // For equity positions, we can't create an option contract
    // Return null - equity exits would need different handling
    return null;
  }

  /**
   * Calculate target price for order
   */
  private calculateTargetPrice(
    quote: Quote,
    side: 'buy' | 'sell',
    orderType: 'limit' | 'market'
  ): number {
    if (orderType === 'market') {
      return side === 'buy' ? quote.ask : quote.bid;
    }

    // For limit orders, use mid price with slight adjustment
    const mid = quote.mid > 0 ? quote.mid : (quote.bid + quote.ask) / 2;
    const adjustment = mid * (this.config.slippagePercent / 100);

    return side === 'buy'
      ? Math.round((mid + adjustment) * 100) / 100 // Buy slightly above mid
      : Math.round((mid - adjustment) * 100) / 100; // Sell slightly below mid
  }

  /**
   * Get underlying symbol from alert
   */
  private getUnderlyingFromAlert(alert: AlertEvent): string {
    // Check context first
    if (alert.context.position?.symbol) {
      return this.getSymbolUnderlying(alert.context.position.symbol);
    }

    // Check trigger-specific info
    const config = alert as unknown as { config?: { symbol?: string } };
    if (config.config?.symbol) {
      return config.config.symbol;
    }

    // Check recommended actions
    for (const action of alert.recommendedActions) {
      if (action.symbols.length > 0) {
        return action.symbols[0]!;
      }
    }

    return 'UNKNOWN';
  }

  /**
   * Extract underlying from position
   */
  private getPositionUnderlying(position: Position): string {
    if (position.optionDetails?.underlying) {
      return position.optionDetails.underlying;
    }
    return position.symbol;
  }

  /**
   * Extract underlying from option symbol
   */
  private getSymbolUnderlying(symbol: string): string {
    // OCC format: AAPL230120C00150000 -> AAPL
    // Try to extract underlying from option symbol
    const match = symbol.match(/^([A-Z]+)\d{6}[CP]\d+$/);
    if (match && match[1]) {
      return match[1];
    }
    return symbol;
  }

  /**
   * Determine exit strategy type based on positions
   */
  private determineExitStrategy(positions: Position[]): StrategyType {
    if (positions.length === 0) return 'custom';

    const firstPosition = positions[0]!;
    if (firstPosition.assetClass !== 'option') {
      return 'custom';
    }

    const optionDetails = firstPosition.optionDetails;
    if (!optionDetails) return 'custom';

    const isLong = firstPosition.quantity > 0;
    const isCall = optionDetails.optionType === 'call';

    if (isLong && isCall) return 'long_call';
    if (isLong && !isCall) return 'long_put';
    if (!isLong && isCall) return 'short_call';
    return 'short_put';
  }

  /**
   * Determine strategy type from alert
   */
  private determineStrategyTypeFromAlert(alert: AlertEvent): string {
    const actions = alert.recommendedActions
      .map((a) => a.action)
      .filter((a) => a !== 'hold' && a !== 'monitor');

    if (actions.includes('exit')) return 'exit';
    if (actions.includes('trim')) return 'trim';
    if (actions.includes('hedge')) return 'hedge';
    return 'monitor';
  }

  /**
   * Estimate net delta of positions
   */
  private estimateNetDelta(positions: Position[]): number {
    let netDelta = 0;

    for (const position of positions) {
      if (position.assetClass === 'equity') {
        netDelta += position.quantity;
      } else if (position.assetClass === 'option' && position.optionDetails?.greeks?.delta) {
        // Options delta * quantity * multiplier
        netDelta += position.optionDetails.greeks.delta * position.quantity * 100;
      }
    }

    return netDelta;
  }

  /**
   * Map alert severity to confidence level
   */
  private mapSeverityToConfidence(severity: AlertEvent['severity']): ConfidenceLevel {
    switch (severity) {
      case 'critical':
        return 'high';
      case 'warning':
        return 'medium';
      case 'info':
      default:
        return 'low';
    }
  }

  /**
   * Format trigger type for display
   */
  private formatTriggerType(type: AlertTriggerType): string {
    switch (type) {
      case 'underlying_move':
        return 'Price movement';
      case 'premium_target':
        return 'Premium target';
      case 'earnings_approaching':
        return 'Earnings event';
      case 'bid_ask_widening':
        return 'Liquidity concern';
      case 'portfolio_drawdown':
        return 'Portfolio drawdown';
      default:
        return type;
    }
  }

  /**
   * Extract catalysts from alert context
   */
  private extractCatalystsFromContext(context: AlertContext): string[] {
    const catalysts: string[] = [];

    if (context.priceChangePercent !== undefined) {
      const direction = context.priceChangePercent >= 0 ? 'up' : 'down';
      catalysts.push(
        `Price moved ${direction} ${Math.abs(context.priceChangePercent).toFixed(1)}%`
      );
    }

    if (context.position?.unrealizedPnLPercent !== undefined) {
      const direction = context.position.unrealizedPnLPercent >= 0 ? 'profit' : 'loss';
      catalysts.push(
        `Position ${direction}: ${Math.abs(context.position.unrealizedPnLPercent).toFixed(1)}%`
      );
    }

    if (context.spreadPercent !== undefined) {
      catalysts.push(`Bid-ask spread: ${context.spreadPercent.toFixed(1)}%`);
    }

    if (context.daysUntilEarnings !== undefined) {
      catalysts.push(`Earnings in ${context.daysUntilEarnings} days`);
    }

    if (context.portfolio?.dailyPnLPercent !== undefined) {
      catalysts.push(
        `Daily P&L: ${context.portfolio.dailyPnLPercent.toFixed(1)}%`
      );
    }

    return catalysts;
  }

  /**
   * Build data sources for the proposal
   */
  private buildDataSources(alert: AlertEvent): DataSource[] {
    return [
      {
        sourceType: 'market_data',
        description: `Alert: ${alert.title}`,
        retrievedAt: alert.triggeredAt,
        reference: `alert:${alert.id}`,
      },
      {
        sourceType: 'other',
        description: `Trigger: ${this.formatTriggerType(alert.triggerType)}`,
        retrievedAt: alert.triggeredAt,
        reference: `trigger:${alert.triggerId}`,
      },
    ];
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an alert action proposals service
 */
export function createAlertActionProposalsService(
  adapter: BrokerAdapter,
  marketDataService: MarketDataService,
  tradeProposalService: TradeProposalService,
  accountId: string,
  config?: AlertActionProposalsConfig,
  auditLogService?: AuditLogService
): AlertActionProposalsService {
  return new AlertActionProposalsService(
    adapter,
    marketDataService,
    tradeProposalService,
    accountId,
    config,
    auditLogService
  );
}

// ============================================================================
// Standalone Function
// ============================================================================

/**
 * Generate a single proposal for an alert action
 *
 * Convenience function for generating proposals without maintaining service state.
 */
export async function generateAlertProposal(
  alert: AlertEvent,
  action: AlertRecommendedAction,
  adapter: BrokerAdapter,
  marketDataService: MarketDataService,
  tradeProposalService: TradeProposalService,
  accountId: string,
  options?: GenerateProposalOptions
): Promise<AlertProposalResult> {
  const service = createAlertActionProposalsService(
    adapter,
    marketDataService,
    tradeProposalService,
    accountId
  );

  return service.generateProposalForAction(
    alert,
    action,
    randomUUID(),
    options
  );
}
