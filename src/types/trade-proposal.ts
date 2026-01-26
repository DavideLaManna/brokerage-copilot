/**
 * Trade Proposal Types
 *
 * Structured format for trade recommendations that can be validated,
 * logged, and executed consistently. Trade proposals capture the full
 * context of a trade idea including thesis, risk, and execution plan.
 */

import { z } from 'zod';

// ============================================================================
// Core Enums and Constants
// ============================================================================

/**
 * Status of a trade proposal in its lifecycle
 */
export type ProposalStatus = 'draft' | 'approved' | 'rejected' | 'executed';

/**
 * Confidence level for the trade recommendation
 */
export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * Type of options trading strategy
 */
export type StrategyType =
  | 'long_call'
  | 'long_put'
  | 'short_call'
  | 'short_put'
  | 'covered_call'
  | 'cash_secured_put'
  | 'vertical_spread'
  | 'calendar_spread'
  | 'iron_condor'
  | 'straddle'
  | 'strangle'
  | 'custom';

// ============================================================================
// Contract Schema
// ============================================================================

/**
 * A single option contract leg in a trade proposal
 */
export interface ProposalContract {
  /** OCC symbol or broker-specific identifier */
  optionSymbol: string;
  /** Underlying ticker */
  underlying: string;
  /** Strike price */
  strike: number;
  /** Expiration date */
  expiration: Date;
  /** Call or put */
  optionType: 'call' | 'put';
  /** Buy or sell this leg */
  side: 'buy' | 'sell';
  /** Number of contracts (always positive) */
  quantity: number;
  /** Expected/target price per contract */
  targetPrice?: number;
}

export const ProposalContractSchema = z.object({
  optionSymbol: z.string().min(1, 'Option symbol is required'),
  underlying: z.string().min(1, 'Underlying symbol is required'),
  strike: z.number().positive('Strike must be positive'),
  expiration: z.date(),
  optionType: z.enum(['call', 'put']),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  targetPrice: z.number().nonnegative().optional(),
});

// ============================================================================
// Entry Plan Schema
// ============================================================================

/**
 * How to enter the trade
 */
export interface EntryPlan {
  /** Order type: limit or market */
  orderType: 'limit' | 'market';
  /** Limit price for the overall position (debit or credit) */
  limitPrice?: number;
  /** Acceptable slippage percentage from target price */
  slippagePercent?: number;
  /** Time in force for the order */
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
  /** Optional notes on entry conditions */
  entryConditions?: string;
}

export const EntryPlanSchema = z.object({
  orderType: z.enum(['limit', 'market']),
  limitPrice: z.number().optional(),
  slippagePercent: z.number().min(0).max(100).optional(),
  timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok']),
  entryConditions: z.string().optional(),
});

// ============================================================================
// Exit Plan Schema
// ============================================================================

/**
 * Target exit prices for profit taking
 */
export interface ProfitTarget {
  /** Percentage gain to trigger this target */
  percentGain: number;
  /** Percentage of position to close at this target */
  closePercent: number;
}

export const ProfitTargetSchema = z.object({
  percentGain: z.number().positive('Percent gain must be positive'),
  closePercent: z.number().min(1).max(100, 'Close percent must be 1-100'),
});

/**
 * Stop loss configuration
 */
export interface StopLoss {
  /** Type of stop: percentage loss or fixed price */
  type: 'percent' | 'price';
  /** Value for the stop (percentage or absolute price) */
  value: number;
  /** Whether to use a trailing stop */
  trailing?: boolean;
}

export const StopLossSchema = z.object({
  type: z.enum(['percent', 'price']),
  value: z.number().positive('Stop value must be positive'),
  trailing: z.boolean().optional(),
});

/**
 * How to exit the trade
 */
export interface ExitPlan {
  /** Profit targets (can be staged/laddered) */
  profitTargets: ProfitTarget[];
  /** Stop loss configuration */
  stopLoss?: StopLoss;
  /** Maximum hold time in days */
  maxHoldDays?: number;
  /** DTE at which to consider closing */
  closeAtDTE?: number;
  /** Optional notes on exit conditions */
  exitNotes?: string;
}

export const ExitPlanSchema = z.object({
  profitTargets: z.array(ProfitTargetSchema).min(1, 'At least one profit target required'),
  stopLoss: StopLossSchema.optional(),
  maxHoldDays: z.number().int().positive().optional(),
  closeAtDTE: z.number().int().nonnegative().optional(),
  exitNotes: z.string().optional(),
});

// ============================================================================
// Risk Assessment Schema
// ============================================================================

/**
 * Risk assessment for the trade
 */
export interface RiskAssessment {
  /** Maximum loss estimate in dollars */
  maxLoss: number;
  /** Maximum loss as percentage of account value */
  maxLossPercent?: number;
  /** Risk-reward ratio (potential profit / potential loss) */
  riskRewardRatio?: number;
  /** Probability of profit estimate (if available) */
  probabilityOfProfit?: number;
  /** Break-even price(s) */
  breakEvenPrices?: number[];
  /** Additional risk notes */
  riskNotes?: string;
}

export const RiskAssessmentSchema = z.object({
  maxLoss: z.number().nonnegative('Max loss must be non-negative'),
  maxLossPercent: z.number().min(0).max(100).optional(),
  riskRewardRatio: z.number().positive().optional(),
  probabilityOfProfit: z.number().min(0).max(100).optional(),
  breakEvenPrices: z.array(z.number()).optional(),
  riskNotes: z.string().optional(),
});

// ============================================================================
// Data Source Schema
// ============================================================================

/**
 * Information about data sources used to generate the proposal
 */
export interface DataSource {
  /** Type of data source */
  sourceType: 'market_data' | 'technical_analysis' | 'news' | 'research' | 'earnings' | 'other';
  /** Description of the data */
  description: string;
  /** When the data was retrieved */
  retrievedAt: Date;
  /** Optional URL or reference */
  reference?: string;
}

export const DataSourceSchema = z.object({
  sourceType: z.enum(['market_data', 'technical_analysis', 'news', 'research', 'earnings', 'other']),
  description: z.string().min(1),
  retrievedAt: z.date(),
  reference: z.string().optional(),
});

// ============================================================================
// Trade Proposal Schema
// ============================================================================

/**
 * Complete trade proposal with all details
 */
export interface TradeProposal {
  /** Type of strategy */
  strategyType: StrategyType;
  /** Primary underlying symbol */
  underlying: string;
  /** Option contracts in the trade */
  contracts: ProposalContract[];
  /** Thesis explaining the trade rationale (bullet points) */
  thesis: string[];
  /** Catalysts that could move the trade */
  catalysts: string[];
  /** Entry plan */
  entryPlan: EntryPlan;
  /** Exit plan with targets and stops */
  exitPlan: ExitPlan;
  /** Risk assessment */
  risk: RiskAssessment;
  /** Confidence level in the recommendation */
  confidence: ConfidenceLevel;
  /** Data sources used to generate the proposal */
  dataUsed: DataSource[];
}

export const TradeProposalSchema = z.object({
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
  underlying: z.string().min(1, 'Underlying symbol is required'),
  contracts: z.array(ProposalContractSchema).min(1, 'At least one contract required'),
  thesis: z.array(z.string().min(1)).min(1, 'At least one thesis point required'),
  catalysts: z.array(z.string()),
  entryPlan: EntryPlanSchema,
  exitPlan: ExitPlanSchema,
  risk: RiskAssessmentSchema,
  confidence: z.enum(['low', 'medium', 'high']),
  dataUsed: z.array(DataSourceSchema),
});

// ============================================================================
// Stored Trade Proposal
// ============================================================================

/**
 * Trade proposal as stored in the database
 */
export interface StoredTradeProposal {
  /** Unique identifier (UUID) */
  id: string;
  /** Account this proposal belongs to */
  accountId: string;
  /** The trade proposal content */
  proposal: TradeProposal;
  /** Current status in the lifecycle */
  status: ProposalStatus;
  /** When the proposal was created */
  createdAt: Date;
  /** When the proposal was last updated */
  updatedAt: Date;
  /** Who/what created the proposal (agent name, user, etc.) */
  createdBy?: string;
  /** Broker order ID if executed */
  executedOrderId?: string;
  /** Reason for rejection if rejected */
  rejectionReason?: string;
  /** User notes */
  notes?: string;
}

export const StoredTradeProposalSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1),
  proposal: TradeProposalSchema,
  status: z.enum(['draft', 'approved', 'rejected', 'executed']),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().optional(),
  executedOrderId: z.string().optional(),
  rejectionReason: z.string().optional(),
  notes: z.string().optional(),
});

// ============================================================================
// Validation
// ============================================================================

/**
 * Result of validating a trade proposal
 */
export interface TradeProposalValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a trade proposal
 */
export function validateTradeProposal(proposal: unknown): TradeProposalValidationResult {
  const result = TradeProposalSchema.safeParse(proposal);
  const warnings: string[] = [];

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      warnings: [],
    };
  }

  const data = result.data;

  // Add warnings for potentially risky configurations

  // High confidence without many data sources
  if (data.confidence === 'high' && data.dataUsed.length < 2) {
    warnings.push('High confidence with few data sources - consider gathering more information');
  }

  // No stop loss configured
  if (!data.exitPlan.stopLoss) {
    warnings.push('No stop loss configured - consider adding one to limit downside');
  }

  // Large position (more than 10 contracts per leg)
  const maxContracts = Math.max(...data.contracts.map((c) => c.quantity));
  if (maxContracts > 10) {
    warnings.push(`Large position size (${maxContracts} contracts) - ensure this fits within risk limits`);
  }

  // Short options without clearly defined risk
  const hasShortOptions = data.contracts.some((c) => c.side === 'sell');
  if (hasShortOptions && data.risk.maxLoss === 0) {
    warnings.push('Short options with $0 max loss - verify risk calculation');
  }

  // Entry plan with market order and no slippage
  if (data.entryPlan.orderType === 'market' && !data.entryPlan.slippagePercent) {
    warnings.push('Market order without slippage estimate - consider using limit order');
  }

  // Exit targets that don't add up to 100%
  const totalExitPercent = data.exitPlan.profitTargets.reduce((sum, t) => sum + t.closePercent, 0);
  if (totalExitPercent !== 100) {
    warnings.push(`Profit targets close ${totalExitPercent}% of position (expected 100%)`);
  }

  // Check for very short DTE options
  const now = new Date();
  for (const contract of data.contracts) {
    const dte = Math.floor((contract.expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (dte < 7) {
      warnings.push(`Contract ${contract.optionSymbol} has only ${dte} DTE - high theta decay risk`);
    }
  }

  // No catalysts for a trade
  if (data.catalysts.length === 0) {
    warnings.push('No catalysts identified - what will drive this trade?');
  }

  return {
    valid: true,
    errors: [],
    warnings,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format strategy type for display
 */
export function formatStrategyType(strategyType: StrategyType): string {
  const names: Record<StrategyType, string> = {
    long_call: 'Long Call',
    long_put: 'Long Put',
    short_call: 'Short Call',
    short_put: 'Short Put',
    covered_call: 'Covered Call',
    cash_secured_put: 'Cash-Secured Put',
    vertical_spread: 'Vertical Spread',
    calendar_spread: 'Calendar Spread',
    iron_condor: 'Iron Condor',
    straddle: 'Straddle',
    strangle: 'Strangle',
    custom: 'Custom Strategy',
  };
  return names[strategyType] || strategyType;
}

/**
 * Format confidence level for display
 */
export function formatConfidence(confidence: ConfidenceLevel): string {
  const names: Record<ConfidenceLevel, string> = {
    low: 'Low Confidence',
    medium: 'Medium Confidence',
    high: 'High Confidence',
  };
  return names[confidence] || confidence;
}

/**
 * Format proposal status for display
 */
export function formatProposalStatus(status: ProposalStatus): string {
  const names: Record<ProposalStatus, string> = {
    draft: 'Draft',
    approved: 'Approved',
    rejected: 'Rejected',
    executed: 'Executed',
  };
  return names[status] || status;
}

/**
 * Calculate total debit/credit for a proposal
 * Positive = debit (paying), Negative = credit (receiving)
 */
export function calculateProposalCost(proposal: TradeProposal): number {
  return proposal.contracts.reduce((total, contract) => {
    const price = contract.targetPrice ?? 0;
    const value = price * contract.quantity * 100; // 100 multiplier for options
    return total + (contract.side === 'buy' ? value : -value);
  }, 0);
}

/**
 * Get a summary line for a trade proposal
 */
export function getProposalSummary(proposal: TradeProposal): string {
  const strategyName = formatStrategyType(proposal.strategyType);
  const contractCount = proposal.contracts.reduce((sum, c) => sum + c.quantity, 0);
  const cost = calculateProposalCost(proposal);
  const costType = cost >= 0 ? 'debit' : 'credit';
  const costValue = Math.abs(cost).toFixed(2);

  return `${strategyName} on ${proposal.underlying} (${contractCount} contracts, $${costValue} ${costType})`;
}
