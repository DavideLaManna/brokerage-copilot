/**
 * Draft Order Builder Service
 *
 * Converts TradeProposals to broker-ready OrderRequests.
 * This service bridges the gap between trade proposals (agent recommendations)
 * and actual broker order formats, applying entry plan parameters and
 * generating idempotency keys to prevent duplicate orders.
 */

import { randomUUID } from 'crypto';
import type {
  OrderRequest,
  OrderType,
  TimeInForce,
} from '../types/broker.js';
import type {
  TradeProposal,
  StoredTradeProposal,
  ProposalContract,
  EntryPlan,
} from '../types/trade-proposal.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A draft order ready for validation and submission
 */
export interface DraftOrder {
  /** The order request in broker format */
  orderRequest: OrderRequest;
  /** Client-generated idempotency key (UUID) to prevent duplicate submissions */
  idempotencyKey: string;
  /** Reference to the source proposal */
  proposalId?: string;
  /** Which leg of the proposal this order represents (0-indexed) */
  legIndex: number;
  /** Contract details from the proposal for reference */
  contractInfo: {
    underlying: string;
    strike: number;
    expiration: Date;
    optionType: 'call' | 'put';
    side: 'buy' | 'sell';
    quantity: number;
    targetPrice?: number;
  };
  /** Calculated order cost (positive = debit, negative = credit) */
  estimatedCost: number;
  /** Timestamp when draft was created */
  createdAt: Date;
}

/**
 * Result of building draft orders from a proposal
 */
export interface BuildDraftOrdersResult {
  /** Successfully created draft orders */
  orders: DraftOrder[];
  /** Any warnings about the orders */
  warnings: string[];
  /** Total estimated cost across all orders (positive = debit) */
  totalEstimatedCost: number;
  /** Correlation ID linking all orders from this proposal */
  correlationId: string;
  /** The source proposal ID if available */
  proposalId?: string;
}

/**
 * Configuration for the draft order builder
 */
export interface DraftOrderBuilderConfig {
  /** Default time in force if not specified in entry plan */
  defaultTimeInForce?: TimeInForce;
  /** Default order type if not specified in entry plan */
  defaultOrderType?: OrderType;
  /** Whether to apply slippage adjustment to limit prices */
  applySlippage?: boolean;
  /** Default contract multiplier for options */
  defaultMultiplier?: number;
}

/**
 * Default configuration
 */
export const DEFAULT_DRAFT_ORDER_CONFIG: Required<DraftOrderBuilderConfig> = {
  defaultTimeInForce: 'day',
  defaultOrderType: 'limit',
  applySlippage: true,
  defaultMultiplier: 100,
};

// ============================================================================
// Draft Order Builder
// ============================================================================

/**
 * Generate a UUID for idempotency
 */
export function generateIdempotencyKey(): string {
  return randomUUID();
}

/**
 * Generate a correlation ID for linking related orders
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Convert entry plan time in force to broker format
 */
function mapTimeInForce(entryPlanTif: EntryPlan['timeInForce']): TimeInForce {
  // EntryPlan and OrderRequest both use the same TIF values
  return entryPlanTif;
}

/**
 * Convert entry plan order type to broker format
 */
function mapOrderType(entryPlanOrderType: EntryPlan['orderType']): OrderType {
  // EntryPlan uses 'limit' | 'market', OrderRequest has more options
  return entryPlanOrderType;
}

/**
 * Calculate the limit price for an order, optionally adjusting for slippage
 */
function calculateLimitPrice(
  contract: ProposalContract,
  entryPlan: EntryPlan,
  config: Required<DraftOrderBuilderConfig>
): number | undefined {
  // Market orders don't have limit prices
  if (entryPlan.orderType === 'market') {
    return undefined;
  }

  // Use the entry plan's overall limit price if available
  // Note: For multi-leg strategies, this represents the net debit/credit
  // For single-leg orders, we use the contract's target price
  let limitPrice = contract.targetPrice ?? entryPlan.limitPrice;

  if (limitPrice === undefined) {
    return undefined;
  }

  // Apply slippage adjustment if configured
  if (config.applySlippage && entryPlan.slippagePercent !== undefined && entryPlan.slippagePercent > 0) {
    const slippageMultiplier = 1 + entryPlan.slippagePercent / 100;

    if (contract.side === 'buy') {
      // For buys, we're willing to pay more
      limitPrice = limitPrice * slippageMultiplier;
    } else {
      // For sells, we're willing to receive less
      limitPrice = limitPrice / slippageMultiplier;
    }
  }

  // Round to 2 decimal places for pricing
  return Math.round(limitPrice * 100) / 100;
}

/**
 * Calculate estimated cost for a single order
 * Positive = debit (buying), negative = credit (selling)
 */
function calculateEstimatedCost(
  contract: ProposalContract,
  limitPrice: number | undefined,
  multiplier: number
): number {
  const price = limitPrice ?? contract.targetPrice ?? 0;
  const value = price * contract.quantity * multiplier;
  return contract.side === 'buy' ? value : -value;
}

/**
 * Build a single draft order from a proposal contract
 */
export function buildDraftOrderFromContract(
  contract: ProposalContract,
  entryPlan: EntryPlan,
  legIndex: number,
  proposalId: string | undefined,
  config: Required<DraftOrderBuilderConfig>
): DraftOrder {
  const limitPrice = calculateLimitPrice(contract, entryPlan, config);
  const estimatedCost = calculateEstimatedCost(contract, limitPrice, config.defaultMultiplier);

  const orderRequest: OrderRequest = {
    symbol: contract.optionSymbol,
    assetClass: 'option',
    side: contract.side,
    orderType: mapOrderType(entryPlan.orderType),
    timeInForce: mapTimeInForce(entryPlan.timeInForce),
    quantity: contract.quantity,
    limitPrice,
    clientOrderId: generateIdempotencyKey(),
    optionDetails: {
      underlying: contract.underlying,
      strike: contract.strike,
      expiration: contract.expiration,
      optionType: contract.optionType,
    },
  };

  return {
    orderRequest,
    idempotencyKey: orderRequest.clientOrderId!,
    proposalId,
    legIndex,
    contractInfo: {
      underlying: contract.underlying,
      strike: contract.strike,
      expiration: contract.expiration,
      optionType: contract.optionType,
      side: contract.side,
      quantity: contract.quantity,
      targetPrice: contract.targetPrice,
    },
    estimatedCost,
    createdAt: new Date(),
  };
}

/**
 * Build draft orders from a TradeProposal
 *
 * This function converts a trade proposal into one or more draft orders
 * that are ready for validation and submission to the broker.
 *
 * For single-leg strategies (e.g., long call), this produces one order.
 * For multi-leg strategies (e.g., vertical spread), this produces multiple orders.
 *
 * @param proposal - The trade proposal to convert
 * @param config - Optional configuration overrides
 * @returns Result containing draft orders, warnings, and metadata
 */
export function buildDraftOrders(
  proposal: TradeProposal,
  config?: DraftOrderBuilderConfig
): BuildDraftOrdersResult {
  const mergedConfig: Required<DraftOrderBuilderConfig> = {
    ...DEFAULT_DRAFT_ORDER_CONFIG,
    ...config,
  };

  const warnings: string[] = [];
  const orders: DraftOrder[] = [];
  const correlationId = generateCorrelationId();
  let totalEstimatedCost = 0;

  // Validate proposal has contracts
  if (!proposal.contracts || proposal.contracts.length === 0) {
    warnings.push('Proposal has no contracts to convert to orders');
    return {
      orders: [],
      warnings,
      totalEstimatedCost: 0,
      correlationId,
    };
  }

  // Warn about market orders
  if (proposal.entryPlan.orderType === 'market') {
    warnings.push('Market order type - no price protection, order will execute at current market price');
  }

  // Warn about missing limit price for limit orders
  if (proposal.entryPlan.orderType === 'limit') {
    const hasAnyPrice = proposal.entryPlan.limitPrice !== undefined ||
                        proposal.contracts.some(c => c.targetPrice !== undefined);
    if (!hasAnyPrice) {
      warnings.push('Limit order without specified price - order may not execute');
    }
  }

  // Build draft orders for each contract leg
  for (let i = 0; i < proposal.contracts.length; i++) {
    const contract = proposal.contracts[i]!;

    // Validate contract has an option symbol
    if (!contract.optionSymbol) {
      warnings.push(`Contract ${i} missing option symbol - cannot create order`);
      continue;
    }

    const draftOrder = buildDraftOrderFromContract(
      contract,
      proposal.entryPlan,
      i,
      undefined, // proposalId set separately for stored proposals
      mergedConfig
    );

    orders.push(draftOrder);
    totalEstimatedCost += draftOrder.estimatedCost;
  }

  // Round total to 2 decimal places
  totalEstimatedCost = Math.round(totalEstimatedCost * 100) / 100;

  return {
    orders,
    warnings,
    totalEstimatedCost,
    correlationId,
  };
}

/**
 * Build draft orders from a StoredTradeProposal
 *
 * This version includes the proposal ID for tracking purposes.
 *
 * @param storedProposal - The stored trade proposal to convert
 * @param config - Optional configuration overrides
 * @returns Result containing draft orders, warnings, and metadata
 */
export function buildDraftOrdersFromStored(
  storedProposal: StoredTradeProposal,
  config?: DraftOrderBuilderConfig
): BuildDraftOrdersResult {
  const result = buildDraftOrders(storedProposal.proposal, config);

  // Add proposal ID to all orders
  for (const order of result.orders) {
    order.proposalId = storedProposal.id;
  }

  // Add proposal ID to result
  result.proposalId = storedProposal.id;

  // Add warning if proposal is not in approved status
  if (storedProposal.status !== 'approved') {
    result.warnings.unshift(
      `Proposal status is '${storedProposal.status}' - only approved proposals should be executed`
    );
  }

  return result;
}

/**
 * Build a single draft order from a proposal (convenience function)
 *
 * This is useful for single-leg strategies where you expect exactly one order.
 * Throws an error if the proposal has multiple contracts.
 *
 * @param proposal - The trade proposal to convert
 * @param config - Optional configuration overrides
 * @returns A single draft order
 * @throws Error if proposal has multiple contracts
 */
export function buildDraftOrder(
  proposal: TradeProposal,
  config?: DraftOrderBuilderConfig
): DraftOrder {
  const result = buildDraftOrders(proposal, config);

  if (result.orders.length === 0) {
    throw new Error('Proposal produced no orders');
  }

  if (result.orders.length > 1) {
    throw new Error(
      `Proposal has ${result.orders.length} legs - use buildDraftOrders() for multi-leg strategies`
    );
  }

  return result.orders[0]!;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate a draft order has all required fields
 */
export function validateDraftOrder(order: DraftOrder): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!order.orderRequest.symbol) {
    errors.push('Order missing symbol');
  }

  if (!order.orderRequest.quantity || order.orderRequest.quantity <= 0) {
    errors.push('Order quantity must be positive');
  }

  if (order.orderRequest.orderType === 'limit' && order.orderRequest.limitPrice === undefined) {
    errors.push('Limit order missing limit price');
  }

  if (order.orderRequest.orderType === 'stop' && order.orderRequest.stopPrice === undefined) {
    errors.push('Stop order missing stop price');
  }

  if (order.orderRequest.orderType === 'stop_limit') {
    if (order.orderRequest.limitPrice === undefined) {
      errors.push('Stop-limit order missing limit price');
    }
    if (order.orderRequest.stopPrice === undefined) {
      errors.push('Stop-limit order missing stop price');
    }
  }

  if (!order.idempotencyKey) {
    errors.push('Order missing idempotency key');
  }

  // Validate option details for option orders
  if (order.orderRequest.assetClass === 'option' && !order.orderRequest.optionDetails) {
    errors.push('Option order missing option details');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate all draft orders in a result
 */
export function validateDraftOrdersResult(result: BuildDraftOrdersResult): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const allErrors: string[] = [];

  for (let i = 0; i < result.orders.length; i++) {
    const order = result.orders[i]!;
    const validation = validateDraftOrder(order);
    if (!validation.valid) {
      allErrors.push(...validation.errors.map(e => `Order ${i}: ${e}`));
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: result.warnings,
  };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a draft order for display
 */
export function formatDraftOrder(order: DraftOrder): string {
  const { orderRequest, contractInfo } = order;
  const sideLabel = orderRequest.side.toUpperCase();
  const typeLabel = contractInfo.optionType === 'call' ? 'C' : 'P';
  const expDate = contractInfo.expiration.toISOString().split('T')[0];

  let priceStr = '';
  if (orderRequest.limitPrice !== undefined) {
    priceStr = ` @ $${orderRequest.limitPrice.toFixed(2)}`;
  }

  const costStr = order.estimatedCost >= 0
    ? `$${order.estimatedCost.toFixed(2)} debit`
    : `$${Math.abs(order.estimatedCost).toFixed(2)} credit`;

  return `${sideLabel} ${orderRequest.quantity}x ${contractInfo.underlying} ${expDate} $${contractInfo.strike} ${typeLabel}${priceStr} (${costStr})`;
}

/**
 * Format all draft orders from a result for display
 */
export function formatDraftOrdersResult(result: BuildDraftOrdersResult): string {
  const lines: string[] = [];

  if (result.orders.length === 0) {
    lines.push('No orders to display');
  } else {
    lines.push(`Orders (${result.orders.length} leg${result.orders.length > 1 ? 's' : ''}):`);
    for (const order of result.orders) {
      lines.push(`  ${formatDraftOrder(order)}`);
    }
  }

  const totalStr = result.totalEstimatedCost >= 0
    ? `$${result.totalEstimatedCost.toFixed(2)} debit`
    : `$${Math.abs(result.totalEstimatedCost).toFixed(2)} credit`;
  lines.push(`Total: ${totalStr}`);

  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠ ${warning}`);
    }
  }

  return lines.join('\n');
}
