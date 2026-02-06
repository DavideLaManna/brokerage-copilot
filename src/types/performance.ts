/**
 * Performance Attribution Types
 *
 * Types for tracking and analyzing trade performance to help users
 * understand which types of trades perform best.
 */

import { z } from 'zod';
import type { StrategyType, ConfidenceLevel } from './trade-proposal.js';

// ============================================================================
// Core Types
// ============================================================================

/**
 * DTE (Days to Expiration) bucket for categorizing trades
 */
export type DTEBucket = '0-7' | '7-14' | '14-30' | '30-60' | '60-90' | '90+';

/**
 * Hold duration bucket for categorizing how long positions were held
 */
export type HoldDurationBucket = 'intraday' | '1-3_days' | '1_week' | '2_weeks' | '1_month' | '1_month+';

/**
 * Catalyst category for trades
 */
export type CatalystCategory =
  | 'earnings'
  | 'technical'
  | 'news'
  | 'sector_move'
  | 'volatility_play'
  | 'none'
  | 'other';

/**
 * Trade outcome classification
 */
export type TradeOutcome = 'win' | 'loss' | 'breakeven';

// ============================================================================
// Closed Trade Record
// ============================================================================

/**
 * A single closed trade for performance tracking
 */
export interface ClosedTrade {
  /** Unique trade ID (UUID) */
  id: string;
  /** Account this trade belongs to */
  accountId: string;
  /** Underlying symbol traded */
  underlying: string;
  /** Strategy type used */
  strategyType: StrategyType;
  /** DTE at entry */
  dteAtEntry: number;
  /** DTE bucket at entry */
  dteBucket: DTEBucket;
  /** Confidence level when proposed */
  confidence?: ConfidenceLevel;
  /** Catalyst category */
  catalyst: CatalystCategory;
  /** Number of contracts traded */
  contracts: number;

  // Entry details
  /** Entry date */
  entryDate: Date;
  /** Entry price (total debit/credit per contract) */
  entryPrice: number;
  /** Total entry cost (positive = debit, negative = credit) */
  entryCost: number;

  // Exit details
  /** Exit date */
  exitDate: Date;
  /** Exit price (total debit/credit per contract) */
  exitPrice: number;
  /** Total exit proceeds (positive = received, negative = paid) */
  exitProceeds: number;

  // Calculated metrics
  /** Realized P&L in dollars */
  realizedPnL: number;
  /** Realized P&L as percentage of entry cost */
  realizedPnLPercent: number;
  /** Trade outcome classification */
  outcome: TradeOutcome;
  /** Hold duration in days */
  holdDays: number;
  /** Hold duration bucket */
  holdDurationBucket: HoldDurationBucket;

  // Commission and fees
  /** Total commission paid */
  commission?: number;
  /** Total fees */
  fees?: number;
  /** Net P&L after commission and fees */
  netPnL: number;

  // Linkage
  /** Original trade proposal ID if available */
  proposalId?: string;
  /** Order IDs for entry */
  entryOrderIds?: string[];
  /** Order IDs for exit */
  exitOrderIds?: string[];

  // Metadata
  /** When this record was created */
  createdAt: Date;
  /** User notes */
  notes?: string;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * Stored closed trade with schema version
 */
export interface StoredClosedTrade extends ClosedTrade {
  /** Schema version for migrations */
  version: number;
}

// ============================================================================
// Aggregated Performance Metrics
// ============================================================================

/**
 * Performance metrics for a group of trades
 */
export interface PerformanceMetrics {
  /** Total number of trades */
  totalTrades: number;
  /** Number of winning trades */
  wins: number;
  /** Number of losing trades */
  losses: number;
  /** Number of breakeven trades */
  breakevens: number;
  /** Win rate (0-100) */
  winRate: number;
  /** Total realized P&L */
  totalPnL: number;
  /** Total net P&L (after commissions/fees) */
  totalNetPnL: number;
  /** Average P&L per trade */
  avgPnL: number;
  /** Average winning trade P&L */
  avgWin: number;
  /** Average losing trade P&L */
  avgLoss: number;
  /** Largest winning trade */
  maxWin: number;
  /** Largest losing trade (negative) */
  maxLoss: number;
  /** Profit factor (gross wins / gross losses) */
  profitFactor: number;
  /** Expectancy (avg win * win rate - avg loss * loss rate) */
  expectancy: number;
  /** Average hold duration in days */
  avgHoldDays: number;
  /** Total commission paid */
  totalCommission: number;
}

/**
 * Performance breakdown by a specific dimension
 */
export interface PerformanceBreakdown<T extends string = string> {
  /** The dimension being analyzed */
  dimension: string;
  /** Metrics grouped by dimension value */
  byValue: Record<T, PerformanceMetrics>;
  /** Best performing value */
  bestPerforming: T | null;
  /** Worst performing value */
  worstPerforming: T | null;
}

/**
 * Complete performance attribution report
 */
export interface PerformanceAttribution {
  /** Account ID */
  accountId: string;
  /** Date range start */
  startDate: Date;
  /** Date range end */
  endDate: Date;
  /** Overall metrics for the period */
  overall: PerformanceMetrics;
  /** Breakdown by strategy type */
  byStrategy: PerformanceBreakdown<StrategyType>;
  /** Breakdown by underlying symbol */
  byUnderlying: PerformanceBreakdown<string>;
  /** Breakdown by DTE bucket */
  byDTEBucket: PerformanceBreakdown<DTEBucket>;
  /** Breakdown by catalyst category */
  byCatalyst: PerformanceBreakdown<CatalystCategory>;
  /** Breakdown by hold duration */
  byHoldDuration: PerformanceBreakdown<HoldDurationBucket>;
  /** Top performing trades */
  topTrades: ClosedTrade[];
  /** Worst performing trades */
  worstTrades: ClosedTrade[];
  /** Identified patterns */
  patterns: PerformancePattern[];
  /** When this report was generated */
  generatedAt: Date;
}

/**
 * An identified performance pattern
 */
export interface PerformancePattern {
  /** Pattern ID */
  id: string;
  /** Pattern type */
  type: 'outperformance' | 'underperformance' | 'correlation' | 'trend';
  /** Human-readable description */
  description: string;
  /** Metrics supporting this pattern */
  metrics: {
    /** Sample size */
    sampleSize: number;
    /** Value being measured */
    value: number;
    /** Comparison baseline (e.g., overall avg) */
    baseline: number;
    /** Difference from baseline */
    difference: number;
    /** Difference as percentage */
    differencePercent: number;
  };
  /** Statistical significance (rough estimate) */
  significance: 'high' | 'medium' | 'low';
  /** Action recommendation */
  recommendation?: string;
}

// ============================================================================
// Drawdown Tracking
// ============================================================================

/**
 * Drawdown information for the portfolio
 */
export interface DrawdownInfo {
  /** Current drawdown from peak (as negative percentage) */
  currentDrawdown: number;
  /** Current drawdown in dollars */
  currentDrawdownDollars: number;
  /** Maximum drawdown seen (most negative) */
  maxDrawdown: number;
  /** Maximum drawdown in dollars */
  maxDrawdownDollars: number;
  /** Peak value reached */
  peakValue: number;
  /** Date of peak */
  peakDate: Date;
  /** Current value */
  currentValue: number;
  /** Days since peak */
  daysSincePeak: number;
}

/**
 * Equity curve point for charting
 */
export interface EquityCurvePoint {
  /** Date */
  date: Date;
  /** Cumulative P&L */
  cumulativePnL: number;
  /** Running total value */
  value: number;
  /** Number of trades closed by this date */
  tradeCount: number;
  /** Drawdown at this point */
  drawdown: number;
}

// ============================================================================
// Query and Filter Types
// ============================================================================

/**
 * Options for querying closed trades
 */
export interface ClosedTradeQueryOptions {
  /** Filter by underlying(s) */
  underlyings?: string[];
  /** Filter by strategy type(s) */
  strategyTypes?: StrategyType[];
  /** Filter by catalyst(s) */
  catalysts?: CatalystCategory[];
  /** Filter by DTE bucket(s) */
  dteBuckets?: DTEBucket[];
  /** Filter by hold duration bucket(s) */
  holdDurationBuckets?: HoldDurationBucket[];
  /** Filter by outcome(s) */
  outcomes?: TradeOutcome[];
  /** Filter by tags */
  tags?: string[];
  /** Filter trades after this date */
  startDate?: Date;
  /** Filter trades before this date */
  endDate?: Date;
  /** Filter by minimum P&L */
  minPnL?: number;
  /** Filter by maximum P&L */
  maxPnL?: number;
  /** Sort field */
  sortBy?: 'exitDate' | 'entryDate' | 'realizedPnL' | 'realizedPnLPercent' | 'holdDays';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Maximum results */
  limit?: number;
  /** Results offset */
  offset?: number;
}

/**
 * Result of a closed trades query
 */
export interface ClosedTradeQueryResult {
  /** Matching trades */
  trades: StoredClosedTrade[];
  /** Total count matching filters */
  totalCount: number;
  /** Whether there are more results */
  hasMore: boolean;
}

/**
 * Options for generating performance attribution
 */
export interface PerformanceAttributionOptions {
  /** Start date for analysis */
  startDate?: Date;
  /** End date for analysis */
  endDate?: Date;
  /** Number of top/worst trades to include */
  topTradesCount?: number;
  /** Minimum sample size for pattern detection */
  minSampleSize?: number;
  /** Filter to specific underlyings */
  underlyings?: string[];
  /** Filter to specific strategies */
  strategyTypes?: StrategyType[];
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const DTEBucketSchema = z.enum(['0-7', '7-14', '14-30', '30-60', '60-90', '90+']);

export const HoldDurationBucketSchema = z.enum([
  'intraday',
  '1-3_days',
  '1_week',
  '2_weeks',
  '1_month',
  '1_month+',
]);

export const CatalystCategorySchema = z.enum([
  'earnings',
  'technical',
  'news',
  'sector_move',
  'volatility_play',
  'none',
  'other',
]);

export const TradeOutcomeSchema = z.enum(['win', 'loss', 'breakeven']);

export const ClosedTradeSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1),
  underlying: z.string().min(1),
  strategyType: z.enum([
    'long_call',
    'long_put',
    'short_call',
    'short_put',
    'covered_call',
    'cash_secured_put',
    'vertical_spread',
    'calendar_spread',
    'iron_condor',
    'straddle',
    'strangle',
    'custom',
  ]),
  dteAtEntry: z.number().int().nonnegative(),
  dteBucket: DTEBucketSchema,
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  catalyst: CatalystCategorySchema,
  contracts: z.number().int().positive(),
  entryDate: z.date(),
  entryPrice: z.number(),
  entryCost: z.number(),
  exitDate: z.date(),
  exitPrice: z.number(),
  exitProceeds: z.number(),
  realizedPnL: z.number(),
  realizedPnLPercent: z.number(),
  outcome: TradeOutcomeSchema,
  holdDays: z.number().nonnegative(),
  holdDurationBucket: HoldDurationBucketSchema,
  commission: z.number().nonnegative().optional(),
  fees: z.number().nonnegative().optional(),
  netPnL: z.number(),
  proposalId: z.string().uuid().optional(),
  entryOrderIds: z.array(z.string()).optional(),
  exitOrderIds: z.array(z.string()).optional(),
  createdAt: z.date(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const StoredClosedTradeSchema = ClosedTradeSchema.extend({
  version: z.number().int().positive(),
});

export const ClosedTradeQueryOptionsSchema = z.object({
  underlyings: z.array(z.string()).optional(),
  strategyTypes: z.array(z.enum([
    'long_call',
    'long_put',
    'short_call',
    'short_put',
    'covered_call',
    'cash_secured_put',
    'vertical_spread',
    'calendar_spread',
    'iron_condor',
    'straddle',
    'strangle',
    'custom',
  ])).optional(),
  catalysts: z.array(CatalystCategorySchema).optional(),
  dteBuckets: z.array(DTEBucketSchema).optional(),
  holdDurationBuckets: z.array(HoldDurationBucketSchema).optional(),
  outcomes: z.array(TradeOutcomeSchema).optional(),
  tags: z.array(z.string()).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  minPnL: z.number().optional(),
  maxPnL: z.number().optional(),
  sortBy: z.enum(['exitDate', 'entryDate', 'realizedPnL', 'realizedPnLPercent', 'holdDays']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

// ============================================================================
// Schema Version
// ============================================================================

export const PERFORMANCE_SCHEMA_VERSION = 1;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine DTE bucket from DTE value
 */
export function getDTEBucket(dte: number): DTEBucket {
  if (dte <= 7) return '0-7';
  if (dte <= 14) return '7-14';
  if (dte <= 30) return '14-30';
  if (dte <= 60) return '30-60';
  if (dte <= 90) return '60-90';
  return '90+';
}

/**
 * Determine hold duration bucket from days held
 */
export function getHoldDurationBucket(days: number): HoldDurationBucket {
  if (days < 1) return 'intraday';
  if (days <= 3) return '1-3_days';
  if (days <= 7) return '1_week';
  if (days <= 14) return '2_weeks';
  if (days <= 30) return '1_month';
  return '1_month+';
}

/**
 * Determine trade outcome from P&L
 */
export function getTradeOutcome(pnl: number, threshold: number = 1): TradeOutcome {
  // Allow a small threshold for "breakeven" (e.g., within $1 of zero)
  if (Math.abs(pnl) <= threshold) return 'breakeven';
  return pnl > 0 ? 'win' : 'loss';
}

/**
 * Calculate hold days between two dates
 */
export function calculateHoldDays(entryDate: Date, exitDate: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = exitDate.getTime() - entryDate.getTime();
  return Math.max(0, Math.round(diff / msPerDay));
}

/**
 * Calculate P&L percentage
 */
export function calculatePnLPercent(pnl: number, entryCost: number): number {
  if (entryCost === 0) return 0;
  // For credits (negative entry cost), we want positive return when we profit
  return (pnl / Math.abs(entryCost)) * 100;
}

/**
 * Format DTE bucket for display
 */
export function formatDTEBucket(bucket: DTEBucket): string {
  const formats: Record<DTEBucket, string> = {
    '0-7': '0-7 DTE',
    '7-14': '7-14 DTE',
    '14-30': '14-30 DTE',
    '30-60': '30-60 DTE',
    '60-90': '60-90 DTE',
    '90+': '90+ DTE',
  };
  return formats[bucket];
}

/**
 * Format hold duration bucket for display
 */
export function formatHoldDurationBucket(bucket: HoldDurationBucket): string {
  const formats: Record<HoldDurationBucket, string> = {
    'intraday': 'Same Day',
    '1-3_days': '1-3 Days',
    '1_week': '1 Week',
    '2_weeks': '2 Weeks',
    '1_month': '1 Month',
    '1_month+': '> 1 Month',
  };
  return formats[bucket];
}

/**
 * Format catalyst category for display
 */
export function formatCatalystCategory(catalyst: CatalystCategory): string {
  const formats: Record<CatalystCategory, string> = {
    'earnings': 'Earnings',
    'technical': 'Technical Setup',
    'news': 'News/Event',
    'sector_move': 'Sector Move',
    'volatility_play': 'Volatility Play',
    'none': 'No Catalyst',
    'other': 'Other',
  };
  return formats[catalyst];
}

/**
 * Format trade outcome for display
 */
export function formatTradeOutcome(outcome: TradeOutcome): string {
  const formats: Record<TradeOutcome, string> = {
    'win': 'Win',
    'loss': 'Loss',
    'breakeven': 'Breakeven',
  };
  return formats[outcome];
}

/**
 * Format performance metrics for display
 */
export function formatPerformanceMetrics(metrics: PerformanceMetrics): string[] {
  const lines: string[] = [];

  lines.push(`Trades: ${metrics.totalTrades} (${metrics.wins}W / ${metrics.losses}L / ${metrics.breakevens}BE)`);
  lines.push(`Win Rate: ${metrics.winRate.toFixed(1)}%`);
  lines.push(`Total P&L: $${metrics.totalPnL.toFixed(2)}`);
  lines.push(`Avg P&L: $${metrics.avgPnL.toFixed(2)}`);
  lines.push(`Avg Win: $${metrics.avgWin.toFixed(2)} | Avg Loss: $${metrics.avgLoss.toFixed(2)}`);
  lines.push(`Max Win: $${metrics.maxWin.toFixed(2)} | Max Loss: $${metrics.maxLoss.toFixed(2)}`);
  lines.push(`Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
  lines.push(`Expectancy: $${metrics.expectancy.toFixed(2)}`);
  lines.push(`Avg Hold: ${metrics.avgHoldDays.toFixed(1)} days`);

  if (metrics.totalCommission > 0) {
    lines.push(`Total Commission: $${metrics.totalCommission.toFixed(2)}`);
  }

  return lines;
}

/**
 * Create empty performance metrics
 */
export function createEmptyMetrics(): PerformanceMetrics {
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    winRate: 0,
    totalPnL: 0,
    totalNetPnL: 0,
    avgPnL: 0,
    avgWin: 0,
    avgLoss: 0,
    maxWin: 0,
    maxLoss: 0,
    profitFactor: 0,
    expectancy: 0,
    avgHoldDays: 0,
    totalCommission: 0,
  };
}

/**
 * Calculate performance metrics from a list of trades
 */
export function calculateMetrics(trades: ClosedTrade[]): PerformanceMetrics {
  if (trades.length === 0) {
    return createEmptyMetrics();
  }

  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let totalPnL = 0;
  let totalNetPnL = 0;
  let totalWinPnL = 0;
  let totalLossPnL = 0;
  let maxWin = 0;
  let maxLoss = 0;
  let totalHoldDays = 0;
  let totalCommission = 0;

  for (const trade of trades) {
    totalPnL += trade.realizedPnL;
    totalNetPnL += trade.netPnL;
    totalHoldDays += trade.holdDays;
    totalCommission += (trade.commission ?? 0) + (trade.fees ?? 0);

    if (trade.outcome === 'win') {
      wins++;
      totalWinPnL += trade.realizedPnL;
      maxWin = Math.max(maxWin, trade.realizedPnL);
    } else if (trade.outcome === 'loss') {
      losses++;
      totalLossPnL += trade.realizedPnL; // This will be negative
      maxLoss = Math.min(maxLoss, trade.realizedPnL);
    } else {
      breakevens++;
    }
  }

  const winRate = (wins / trades.length) * 100;
  const avgPnL = totalPnL / trades.length;
  const avgWin = wins > 0 ? totalWinPnL / wins : 0;
  const avgLoss = losses > 0 ? totalLossPnL / losses : 0;
  const avgHoldDays = totalHoldDays / trades.length;

  // Profit factor = gross wins / |gross losses|
  const profitFactor = Math.abs(totalLossPnL) > 0
    ? totalWinPnL / Math.abs(totalLossPnL)
    : totalWinPnL > 0 ? Infinity : 0;

  // Expectancy = (win% * avg win) + (loss% * avg loss)
  const winPct = wins / trades.length;
  const lossPct = losses / trades.length;
  const expectancy = (winPct * avgWin) + (lossPct * avgLoss);

  return {
    totalTrades: trades.length,
    wins,
    losses,
    breakevens,
    winRate,
    totalPnL,
    totalNetPnL,
    avgPnL,
    avgWin,
    avgLoss,
    maxWin,
    maxLoss,
    profitFactor: isFinite(profitFactor) ? profitFactor : 0,
    expectancy,
    avgHoldDays,
    totalCommission,
  };
}

/**
 * Validate a closed trade record
 */
export function validateClosedTrade(trade: unknown): {
  valid: boolean;
  errors: string[];
} {
  const result = ClosedTradeSchema.safeParse(trade);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
    };
  }
  return { valid: true, errors: [] };
}
