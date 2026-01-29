/**
 * Order Repricing Types
 *
 * Defines types and schemas for the order repricing engine.
 * The repricing engine detects stale limit orders and proposes
 * new limit prices closer to the current mid-price.
 */

import { z } from 'zod';
import type { Order, OrderSide, TimeInForce } from './broker.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the order repricing engine
 */
export interface RepricingConfig {
  /** Percentage deviation threshold to trigger repricing (default: 5%) */
  priceDeviationThreshold: number;
  /** Minimum order age in seconds before repricing is considered (default: 300) */
  minOrderAgeSeconds: number;
  /** Band percentage for new price relative to mid (default: 2%) */
  repriceBandPercent: number;
  /** Whether to include options in repricing (default: true) */
  includeOptions: boolean;
  /** Whether to include equities in repricing (default: true) */
  includeEquities: boolean;
  /** Maximum number of orders to scan per batch (default: 50) */
  maxOrdersPerScan: number;
  /** Minimum mid price to consider (avoids penny stocks, default: 0.01) */
  minMidPrice: number;
  /** Whether automatic repricing is enabled (default: false) */
  autoRepriceEnabled: boolean;
  /** Band percentage for automatic repricing (default: 2%) - orders within this band are auto-repriced without approval */
  autoRepriceBandPercent: number;
}

/**
 * Zod schema for repricing config validation
 */
export const RepricingConfigSchema = z.object({
  priceDeviationThreshold: z.number().positive().max(100),
  minOrderAgeSeconds: z.number().int().nonnegative(),
  repriceBandPercent: z.number().positive().max(100),
  includeOptions: z.boolean(),
  includeEquities: z.boolean(),
  maxOrdersPerScan: z.number().int().positive(),
  minMidPrice: z.number().nonnegative(),
  autoRepriceEnabled: z.boolean(),
  autoRepriceBandPercent: z.number().positive().max(100),
});

/**
 * Default repricing configuration
 */
export const DEFAULT_REPRICING_CONFIG: RepricingConfig = {
  priceDeviationThreshold: 5, // 5% away from mid
  minOrderAgeSeconds: 300, // 5 minutes old
  repriceBandPercent: 2, // Move to within 2% of mid
  includeOptions: true,
  includeEquities: true,
  maxOrdersPerScan: 50,
  minMidPrice: 0.01,
  autoRepriceEnabled: false, // Disabled by default for safety
  autoRepriceBandPercent: 2, // 2% band for auto-repricing
};

// ============================================================================
// Repricing Proposal Types
// ============================================================================

/**
 * Status of a repricing proposal
 */
export type RepricingProposalStatus =
  | 'proposed' // Proposal generated, awaiting user review
  | 'approved' // User approved, ready for execution
  | 'rejected' // User rejected the proposal
  | 'executed' // Successfully modified the order
  | 'failed' // Modification attempt failed
  | 'expired'; // Order was filled/canceled before modification

/**
 * Source of a repricing action - used for audit trail tagging
 */
export type RepricingSource = 'manual' | 'auto_housekeeping';

/**
 * A proposal to reprice an existing limit order
 */
export interface RepricingProposal {
  /** Unique ID for this repricing proposal (UUID) */
  id: string;
  /** Account ID */
  accountId: string;
  /** Original broker order ID */
  orderId: string;
  /** Symbol being traded */
  symbol: string;
  /** Asset class */
  assetClass: 'equity' | 'option';
  /** Order side */
  side: OrderSide;
  /** Current limit price on the order */
  currentLimitPrice: number;
  /** Current mid price from market data */
  currentMidPrice: number;
  /** Current bid price */
  currentBid: number;
  /** Current ask price */
  currentAsk: number;
  /** Percentage deviation from mid */
  deviationPercent: number;
  /** Proposed new limit price */
  proposedLimitPrice: number;
  /** Percentage improvement (how much closer to mid) */
  improvementPercent: number;
  /** Rationale for the repricing */
  rationale: string[];
  /** Status of the proposal */
  status: RepricingProposalStatus;
  /** Order quantity */
  quantity: number;
  /** Order time in force */
  timeInForce: TimeInForce;
  /** When the order was originally submitted */
  orderSubmittedAt: Date;
  /** When the proposal was created */
  createdAt: Date;
  /** When the proposal was last updated */
  updatedAt: Date;
  /** When the proposal was approved (if approved) */
  approvedAt?: Date;
  /** When the proposal was rejected (if rejected) */
  rejectedAt?: Date;
  /** Rejection reason (if rejected) */
  rejectionReason?: string;
  /** When the modification was executed (if executed) */
  executedAt?: Date;
  /** New order ID after modification (if executed) */
  newOrderId?: string;
  /** Error message (if failed) */
  errorMessage?: string;
  /** Source of the repricing action */
  source: RepricingSource;
  /** Whether this was auto-executed (no user approval required) */
  autoExecuted?: boolean;
}

/**
 * Zod schema for repricing proposal
 */
export const RepricingProposalSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1),
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  assetClass: z.enum(['equity', 'option']),
  side: z.enum(['buy', 'sell']),
  currentLimitPrice: z.number().positive(),
  currentMidPrice: z.number().positive(),
  currentBid: z.number().nonnegative(),
  currentAsk: z.number().positive(),
  deviationPercent: z.number(),
  proposedLimitPrice: z.number().positive(),
  improvementPercent: z.number(),
  rationale: z.array(z.string()),
  status: z.enum([
    'proposed',
    'approved',
    'rejected',
    'executed',
    'failed',
    'expired',
  ]),
  source: z.enum(['manual', 'auto_housekeeping']),
  autoExecuted: z.boolean().optional(),
  quantity: z.number().int().positive(),
  timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok']),
  orderSubmittedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  approvedAt: z.date().optional(),
  rejectedAt: z.date().optional(),
  rejectionReason: z.string().optional(),
  executedAt: z.date().optional(),
  newOrderId: z.string().optional(),
  errorMessage: z.string().optional(),
});

/**
 * Stored repricing proposal with additional metadata
 */
export interface StoredRepricingProposal extends RepricingProposal {
  /** Storage version for schema migrations */
  version: number;
}

// ============================================================================
// Order Modification Types
// ============================================================================

/**
 * Represents a requested modification to an existing order
 * Note: Most brokers don't support direct order modification.
 * Modification typically requires canceling and replacing the order.
 */
export interface OrderModification {
  /** Original order ID to modify */
  orderId: string;
  /** New limit price */
  newLimitPrice: number;
  /** Optional new quantity (if changing) */
  newQuantity?: number;
  /** Repricing proposal ID that generated this modification */
  proposalId: string;
}

/**
 * Result of an order modification attempt
 */
export interface OrderModificationResult {
  /** Whether the modification succeeded */
  success: boolean;
  /** Original order ID */
  originalOrderId: string;
  /** New order ID (if cancel/replace was used) */
  newOrderId?: string;
  /** Previous limit price */
  previousLimitPrice: number;
  /** New limit price */
  newLimitPrice: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Error code if failed */
  errorCode?: string;
  /** Timestamp of the result */
  timestamp: Date;
}

// ============================================================================
// Auto-Reprice Types
// ============================================================================

/**
 * Result of an automatic repricing operation
 */
export interface AutoRepriceResult {
  /** Unique ID for this auto-reprice operation */
  id: string;
  /** Timestamp of the operation */
  timestamp: Date;
  /** Orders that were automatically repriced */
  repriced: Array<{
    orderId: string;
    symbol: string;
    previousPrice: number;
    newPrice: number;
    newOrderId?: string;
    success: boolean;
    errorMessage?: string;
  }>;
  /** Orders that were skipped (outside auto-reprice band or validation failed) */
  skipped: Array<{
    orderId: string;
    symbol: string;
    reason: string;
  }>;
  /** Total orders scanned */
  ordersScanned: number;
  /** Orders successfully repriced */
  successCount: number;
  /** Orders that failed repricing */
  failedCount: number;
  /** Whether auto-repricing is still enabled after this scan */
  autoRepriceStillEnabled: boolean;
  /** Reason if auto-reprice was disabled */
  disabledReason?: string;
}

/**
 * Notification for auto-reprice activity
 */
export interface AutoRepriceNotification {
  /** Unique ID */
  id: string;
  /** Type of notification */
  type: 'success' | 'warning' | 'error' | 'info';
  /** Short title */
  title: string;
  /** Detailed message */
  message: string;
  /** Related order IDs */
  orderIds: string[];
  /** Related symbols */
  symbols: string[];
  /** Timestamp */
  timestamp: Date;
  /** Whether this has been dismissed */
  dismissed: boolean;
  /** Auto-reprice result if applicable */
  result?: AutoRepriceResult;
}

/**
 * Check if an order qualifies for auto-repricing (within the safe band)
 * Auto-repricing is more conservative than manual repricing proposals
 */
export function orderQualifiesForAutoReprice(
  deviationPercent: number,
  proposedDeviationPercent: number,
  autoRepriceBandPercent: number
): boolean {
  // Order must be outside the band to trigger repricing
  // AND the proposed price must be within the auto-reprice band
  // This ensures we only auto-reprice to "safe" prices
  return Math.abs(proposedDeviationPercent) <= autoRepriceBandPercent;
}

// ============================================================================
// Scan Results
// ============================================================================

/**
 * Result of scanning orders for repricing opportunities
 */
export interface RepricingScanResult {
  /** Orders that were scanned */
  ordersScanned: number;
  /** Orders that qualify for repricing */
  ordersQualifying: number;
  /** Generated proposals */
  proposals: RepricingProposal[];
  /** Orders skipped (with reasons) */
  skipped: Array<{
    orderId: string;
    symbol: string;
    reason: string;
  }>;
  /** Scan timestamp */
  scannedAt: Date;
  /** Configuration used for scanning */
  configUsed: RepricingConfig;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate the deviation percentage between limit price and mid price
 * Positive = limit is above mid, Negative = limit is below mid
 */
export function calculateDeviationPercent(
  limitPrice: number,
  midPrice: number
): number {
  if (midPrice === 0) return 0;
  return ((limitPrice - midPrice) / midPrice) * 100;
}

/**
 * Calculate the proposed limit price based on the repricing band
 * For BUY orders: price slightly below mid
 * For SELL orders: price slightly above mid
 */
export function calculateProposedPrice(
  side: OrderSide,
  midPrice: number,
  bandPercent: number
): number {
  const bandFactor = bandPercent / 100;
  if (side === 'buy') {
    // For buy orders, we want to buy at or below mid
    return midPrice * (1 - bandFactor);
  } else {
    // For sell orders, we want to sell at or above mid
    return midPrice * (1 + bandFactor);
  }
}

/**
 * Check if an order qualifies for repricing based on the config
 */
export function orderQualifiesForRepricing(
  order: Order,
  midPrice: number,
  config: RepricingConfig,
  orderAgeSeconds: number
): { qualifies: boolean; reason?: string } {
  // Must be a limit order
  if (order.orderType !== 'limit') {
    return { qualifies: false, reason: 'Not a limit order' };
  }

  // Must have a limit price
  if (order.limitPrice === undefined || order.limitPrice === null) {
    return { qualifies: false, reason: 'No limit price set' };
  }

  // Must be open or partially filled
  if (order.status !== 'open' && order.status !== 'partially_filled') {
    return { qualifies: false, reason: `Order status is ${order.status}` };
  }

  // Check asset class filter
  if (order.assetClass === 'option' && !config.includeOptions) {
    return { qualifies: false, reason: 'Options excluded from repricing' };
  }
  if (order.assetClass === 'equity' && !config.includeEquities) {
    return { qualifies: false, reason: 'Equities excluded from repricing' };
  }

  // Check minimum mid price
  if (midPrice < config.minMidPrice) {
    return { qualifies: false, reason: `Mid price ${midPrice} below minimum ${config.minMidPrice}` };
  }

  // Check order age
  if (orderAgeSeconds < config.minOrderAgeSeconds) {
    return {
      qualifies: false,
      reason: `Order is ${orderAgeSeconds}s old, minimum is ${config.minOrderAgeSeconds}s`,
    };
  }

  // Check deviation threshold
  const deviationPercent = Math.abs(
    calculateDeviationPercent(order.limitPrice, midPrice)
  );
  if (deviationPercent <= config.priceDeviationThreshold) {
    return {
      qualifies: false,
      reason: `Deviation ${deviationPercent.toFixed(2)}% within threshold ${config.priceDeviationThreshold}%`,
    };
  }

  return { qualifies: true };
}

/**
 * Generate rationale strings for a repricing proposal
 */
export function generateRepricingRationale(
  order: Order,
  midPrice: number,
  proposedPrice: number,
  deviationPercent: number,
  bid: number,
  ask: number
): string[] {
  const rationale: string[] = [];

  // Current deviation
  const deviationDirection = deviationPercent > 0 ? 'above' : 'below';
  rationale.push(
    `Current limit $${order.limitPrice!.toFixed(2)} is ${Math.abs(deviationPercent).toFixed(1)}% ${deviationDirection} mid $${midPrice.toFixed(2)}`
  );

  // Market context
  const spreadPercent = ((ask - bid) / midPrice) * 100;
  rationale.push(
    `Current market: $${bid.toFixed(2)} x $${ask.toFixed(2)} (${spreadPercent.toFixed(1)}% spread)`
  );

  // New price benefit
  const improvement =
    Math.abs(order.limitPrice! - midPrice) - Math.abs(proposedPrice - midPrice);
  rationale.push(
    `Proposed $${proposedPrice.toFixed(2)} is $${improvement.toFixed(2)} closer to market mid`
  );

  // Fill probability
  if (order.side === 'buy') {
    if (proposedPrice >= bid) {
      rationale.push('Proposed price is at or above bid, likely to fill');
    } else {
      rationale.push('Proposed price is competitive with current bids');
    }
  } else {
    if (proposedPrice <= ask) {
      rationale.push('Proposed price is at or below ask, likely to fill');
    } else {
      rationale.push('Proposed price is competitive with current asks');
    }
  }

  return rationale;
}

/**
 * Format a repricing proposal for display
 */
export function formatRepricingProposal(proposal: RepricingProposal): string {
  const lines: string[] = [];

  lines.push(`Repricing Proposal: ${proposal.symbol}`);
  lines.push(`Status: ${proposal.status.toUpperCase()}`);
  lines.push(`Order ID: ${proposal.orderId}`);
  lines.push(`Side: ${proposal.side.toUpperCase()}`);
  lines.push(`Quantity: ${proposal.quantity}`);
  lines.push('');
  lines.push('Price Change:');
  lines.push(`  Current: $${proposal.currentLimitPrice.toFixed(2)}`);
  lines.push(`  Proposed: $${proposal.proposedLimitPrice.toFixed(2)}`);
  lines.push(`  Market Mid: $${proposal.currentMidPrice.toFixed(2)}`);
  lines.push(`  Deviation: ${proposal.deviationPercent.toFixed(1)}%`);
  lines.push(`  Improvement: ${proposal.improvementPercent.toFixed(1)}%`);
  lines.push('');
  lines.push('Rationale:');
  for (const reason of proposal.rationale) {
    lines.push(`  • ${reason}`);
  }

  return lines.join('\n');
}

/**
 * Validate a repricing config
 */
export function validateRepricingConfig(config: unknown): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const result = RepricingConfigSchema.safeParse(config);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      warnings: [],
    };
  }

  const cfg = result.data;

  // Check for aggressive settings
  if (cfg.priceDeviationThreshold < 2) {
    warnings.push('Very low deviation threshold may generate many proposals');
  }
  if (cfg.repriceBandPercent > cfg.priceDeviationThreshold) {
    warnings.push('Reprice band is larger than deviation threshold');
  }
  if (cfg.minOrderAgeSeconds < 60) {
    warnings.push('Very low minimum order age may reprice orders prematurely');
  }

  // Auto-reprice specific warnings
  if (cfg.autoRepriceEnabled) {
    if (cfg.autoRepriceBandPercent > 5) {
      warnings.push('Large auto-reprice band (>5%) may result in significant price changes without approval');
    }
    if (cfg.autoRepriceBandPercent > cfg.repriceBandPercent) {
      warnings.push('Auto-reprice band is larger than manual reprice band - auto-reprice will be less restrictive');
    }
    if (cfg.minOrderAgeSeconds < 120) {
      warnings.push('Very low minimum order age with auto-reprice enabled may modify orders too quickly');
    }
  }

  return { valid: true, errors, warnings };
}

/**
 * Current schema version for stored proposals
 */
export const REPRICING_SCHEMA_VERSION = 1;
