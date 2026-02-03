/**
 * Multi-Leg Spread Types
 *
 * Types and utilities for handling multi-leg option spread strategies.
 * Includes spread definitions, max loss calculations, and broker capability checking.
 */

import { z } from 'zod';
import type { OptionType, OrderSide, TimeInForce, OrderType, OrderRequest } from './broker.js';
import type { StrategyType, ProposalContract } from './trade-proposal.js';

// ============================================================================
// Spread Strategy Definitions
// ============================================================================

/**
 * Spread strategy subtypes for more specific categorization
 */
export type SpreadSubtype =
  | 'call_debit_spread'    // Long lower strike call, short higher strike call
  | 'call_credit_spread'   // Short lower strike call, long higher strike call
  | 'put_debit_spread'     // Long higher strike put, short lower strike put
  | 'put_credit_spread'    // Short higher strike put, long lower strike put
  | 'call_calendar'        // Same strike, different expirations (calls)
  | 'put_calendar'         // Same strike, different expirations (puts)
  | 'iron_condor'          // OTM put spread + OTM call spread
  | 'iron_butterfly'       // ATM put spread + ATM call spread (same short strikes)
  | 'long_straddle'        // Long call + long put at same strike
  | 'short_straddle'       // Short call + short put at same strike
  | 'long_strangle'        // Long call + long put at different strikes
  | 'short_strangle'       // Short call + short put at different strikes
  | 'custom';

export const SpreadSubtypeSchema = z.enum([
  'call_debit_spread',
  'call_credit_spread',
  'put_debit_spread',
  'put_credit_spread',
  'call_calendar',
  'put_calendar',
  'iron_condor',
  'iron_butterfly',
  'long_straddle',
  'short_straddle',
  'long_strangle',
  'short_strangle',
  'custom',
]);

/**
 * Information about a spread leg
 */
export interface SpreadLeg {
  /** Leg index (0-based) */
  legIndex: number;
  /** Option symbol */
  optionSymbol: string;
  /** Underlying symbol */
  underlying: string;
  /** Strike price */
  strike: number;
  /** Expiration date */
  expiration: Date;
  /** Call or put */
  optionType: OptionType;
  /** Buy or sell */
  side: OrderSide;
  /** Number of contracts */
  quantity: number;
  /** Leg ratio (typically 1:1, but can differ for ratio spreads) */
  ratio: number;
}

export const SpreadLegSchema = z.object({
  legIndex: z.number().int().nonnegative(),
  optionSymbol: z.string().min(1),
  underlying: z.string().min(1),
  strike: z.number().positive(),
  expiration: z.date(),
  optionType: z.enum(['call', 'put']),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().positive(),
  ratio: z.number().positive().default(1),
});

/**
 * Complete spread definition with all legs and metadata
 */
export interface SpreadDefinition {
  /** Strategy type from TradeProposal */
  strategyType: StrategyType;
  /** More specific spread subtype */
  spreadSubtype: SpreadSubtype;
  /** Underlying symbol */
  underlying: string;
  /** All legs of the spread */
  legs: SpreadLeg[];
  /** Whether this is a debit (pay) or credit (receive) spread */
  isDebit: boolean;
  /** Net premium (positive = debit, negative = credit) */
  netPremium: number;
  /** Width of the spread in strike price terms (for verticals) */
  spreadWidth?: number;
  /** Number of spread units */
  quantity: number;
  /** Contract multiplier (typically 100) */
  multiplier: number;
}

export const SpreadDefinitionSchema = z.object({
  strategyType: z.string(),
  spreadSubtype: SpreadSubtypeSchema,
  underlying: z.string().min(1),
  legs: z.array(SpreadLegSchema).min(1),
  isDebit: z.boolean(),
  netPremium: z.number(),
  spreadWidth: z.number().positive().optional(),
  quantity: z.number().int().positive(),
  multiplier: z.number().positive().default(100),
});

// ============================================================================
// Spread Order Types
// ============================================================================

/**
 * A multi-leg spread order request
 */
export interface SpreadOrderRequest {
  /** Spread definition */
  spread: SpreadDefinition;
  /** Order type (limit recommended for spreads) */
  orderType: OrderType;
  /** Net limit price for the spread (positive = debit, negative = credit) */
  netLimitPrice?: number;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Client-generated idempotency key */
  clientOrderId?: string;
  /** Whether to execute as one atomic transaction (if broker supports) */
  executeAtomic: boolean;
}

export const SpreadOrderRequestSchema = z.object({
  spread: SpreadDefinitionSchema,
  orderType: z.enum(['market', 'limit', 'stop', 'stop_limit']),
  netLimitPrice: z.number().optional(),
  timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok']),
  clientOrderId: z.string().uuid().optional(),
  executeAtomic: z.boolean().default(true),
});

/**
 * Result of converting a spread to individual leg orders
 */
export interface SpreadToOrdersResult {
  /** Individual OrderRequest objects for each leg */
  legOrders: OrderRequest[];
  /** Correlation ID linking all legs */
  correlationId: string;
  /** Net debit/credit for the spread */
  netPremium: number;
  /** Calculated max loss for the spread */
  maxLoss: number;
  /** Calculated max profit for the spread */
  maxProfit: number;
  /** Break-even prices */
  breakEvenPrices: number[];
  /** Warnings about the spread */
  warnings: string[];
}

// ============================================================================
// Broker Capability Types
// ============================================================================

/**
 * Options trading approval level for a broker account
 */
export type OptionsLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Broker-specific options trading capabilities
 */
export interface BrokerOptionsCapabilities {
  /** Options approval level (0 = none, 4 = highest) */
  optionsLevel: OptionsLevel;
  /** Whether the account can trade single-leg options */
  canTradeSingleLeg: boolean;
  /** Whether the account can trade vertical spreads */
  canTradeVerticalSpreads: boolean;
  /** Whether the account can trade calendar spreads */
  canTradeCalendarSpreads: boolean;
  /** Whether the account can trade iron condors/butterflies */
  canTradeIronCondors: boolean;
  /** Whether the account can sell naked options */
  canSellNakedOptions: boolean;
  /** Whether the broker supports atomic multi-leg orders */
  supportsAtomicMultiLeg: boolean;
  /** Whether the account is a margin account */
  isMarginAccount: boolean;
  /** Description of the capabilities */
  description: string;
}

export const BrokerOptionsCapabilitiesSchema = z.object({
  optionsLevel: z.number().int().min(0).max(4),
  canTradeSingleLeg: z.boolean(),
  canTradeVerticalSpreads: z.boolean(),
  canTradeCalendarSpreads: z.boolean(),
  canTradeIronCondors: z.boolean(),
  canSellNakedOptions: z.boolean(),
  supportsAtomicMultiLeg: z.boolean(),
  isMarginAccount: z.boolean(),
  description: z.string(),
});

/**
 * Requirements for trading a specific spread type
 */
export interface SpreadCapabilityRequirement {
  /** Minimum options level required */
  minOptionsLevel: OptionsLevel;
  /** Whether margin account is required */
  requiresMargin: boolean;
  /** Whether atomic execution is recommended */
  recommendAtomicExecution: boolean;
  /** Description of requirements */
  description: string;
}

// ============================================================================
// Spread Risk Calculation Types
// ============================================================================

/**
 * Risk metrics for a spread strategy
 */
export interface SpreadRiskMetrics {
  /** Maximum possible loss */
  maxLoss: number;
  /** Maximum possible profit */
  maxProfit: number;
  /** Risk/reward ratio (maxLoss / maxProfit) */
  riskRewardRatio: number;
  /** Break-even price(s) for the underlying */
  breakEvenPrices: number[];
  /** Probability of profit estimate (if available) */
  probabilityOfProfit?: number;
  /** Net premium paid/received */
  netPremium: number;
  /** Whether this is a defined risk strategy */
  isDefinedRisk: boolean;
  /** Description of the risk profile */
  riskDescription: string;
}

export const SpreadRiskMetricsSchema = z.object({
  maxLoss: z.number().nonnegative(),
  maxProfit: z.number().nonnegative(),
  riskRewardRatio: z.number().nonnegative(),
  breakEvenPrices: z.array(z.number()),
  probabilityOfProfit: z.number().min(0).max(100).optional(),
  netPremium: z.number(),
  isDefinedRisk: z.boolean(),
  riskDescription: z.string(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine the spread subtype from the strategy type and legs
 */
export function determineSpreadSubtype(
  strategyType: StrategyType,
  legs: SpreadLeg[]
): SpreadSubtype {
  // Single leg strategies
  if (legs.length === 1) {
    return 'custom';
  }

  // Two-leg spreads
  if (legs.length === 2) {
    const [leg1, leg2] = [legs[0]!, legs[1]!];

    // Check if same expiration
    const sameExpiration = leg1.expiration.getTime() === leg2.expiration.getTime();
    const sameStrike = leg1.strike === leg2.strike;

    // Straddle or strangle (call + put combination)
    if (sameExpiration && leg1.optionType !== leg2.optionType) {
      const bothLong = leg1.side === 'buy' && leg2.side === 'buy';
      const bothShort = leg1.side === 'sell' && leg2.side === 'sell';
      if (sameStrike) {
        return bothLong ? 'long_straddle' : bothShort ? 'short_straddle' : 'custom';
      }
      return bothLong ? 'long_strangle' : bothShort ? 'short_strangle' : 'custom';
    }

    // Vertical spread (same expiration, different strikes, same option type)
    if (sameExpiration && !sameStrike) {
      if (leg1.optionType === 'call' && leg2.optionType === 'call') {
        const longLeg = leg1.side === 'buy' ? leg1 : leg2;
        const shortLeg = leg1.side === 'sell' ? leg1 : leg2;
        return longLeg.strike < shortLeg.strike ? 'call_debit_spread' : 'call_credit_spread';
      }
      if (leg1.optionType === 'put' && leg2.optionType === 'put') {
        const longLeg = leg1.side === 'buy' ? leg1 : leg2;
        const shortLeg = leg1.side === 'sell' ? leg1 : leg2;
        return longLeg.strike > shortLeg.strike ? 'put_debit_spread' : 'put_credit_spread';
      }
    }

    // Calendar spread (same strike, different expiration)
    if (!sameExpiration && sameStrike) {
      return leg1.optionType === 'call' ? 'call_calendar' : 'put_calendar';
    }
  }

  // Iron condor / butterfly (4 legs)
  if (legs.length === 4) {
    const puts = legs.filter(l => l.optionType === 'put');
    const calls = legs.filter(l => l.optionType === 'call');

    if (puts.length === 2 && calls.length === 2) {
      const putStrikes = puts.map(p => p.strike).sort((a, b) => a - b);
      const callStrikes = calls.map(c => c.strike).sort((a, b) => a - b);

      // Iron condor: short strikes are different
      // Iron butterfly: short strikes are the same
      const shortPut = puts.find(p => p.side === 'sell');
      const shortCall = calls.find(c => c.side === 'sell');

      if (shortPut && shortCall) {
        if (shortPut.strike === shortCall.strike) {
          return 'iron_butterfly';
        }
        return 'iron_condor';
      }
    }
  }

  return 'custom';
}

/**
 * Get the capability requirements for a spread type
 */
export function getSpreadCapabilityRequirements(
  spreadSubtype: SpreadSubtype
): SpreadCapabilityRequirement {
  switch (spreadSubtype) {
    case 'call_debit_spread':
    case 'put_debit_spread':
      return {
        minOptionsLevel: 2,
        requiresMargin: false,
        recommendAtomicExecution: true,
        description: 'Debit spreads require options level 2 (defined risk)',
      };

    case 'call_credit_spread':
    case 'put_credit_spread':
      return {
        minOptionsLevel: 2,
        requiresMargin: true,
        recommendAtomicExecution: true,
        description: 'Credit spreads require options level 2 and margin account',
      };

    case 'call_calendar':
    case 'put_calendar':
      return {
        minOptionsLevel: 3,
        requiresMargin: true,
        recommendAtomicExecution: true,
        description: 'Calendar spreads require options level 3 and margin account',
      };

    case 'iron_condor':
    case 'iron_butterfly':
      return {
        minOptionsLevel: 3,
        requiresMargin: true,
        recommendAtomicExecution: true,
        description: 'Iron condors/butterflies require options level 3 and margin account',
      };

    case 'long_straddle':
    case 'long_strangle':
      return {
        minOptionsLevel: 2,
        requiresMargin: false,
        recommendAtomicExecution: true,
        description: 'Long straddles/strangles require options level 2 (defined risk)',
      };

    case 'short_straddle':
    case 'short_strangle':
      return {
        minOptionsLevel: 4,
        requiresMargin: true,
        recommendAtomicExecution: true,
        description: 'Short straddles/strangles require options level 4 (naked options)',
      };

    default:
      return {
        minOptionsLevel: 3,
        requiresMargin: true,
        recommendAtomicExecution: true,
        description: 'Custom strategies require options level 3 and manual review',
      };
  }
}

/**
 * Check if broker capabilities meet spread requirements
 */
export function canTradeSpread(
  capabilities: BrokerOptionsCapabilities,
  spreadSubtype: SpreadSubtype
): { allowed: boolean; reason?: string } {
  const requirements = getSpreadCapabilityRequirements(spreadSubtype);

  // Check options level
  if (capabilities.optionsLevel < requirements.minOptionsLevel) {
    return {
      allowed: false,
      reason: `Requires options level ${requirements.minOptionsLevel}, account has level ${capabilities.optionsLevel}`,
    };
  }

  // Check margin requirement
  if (requirements.requiresMargin && !capabilities.isMarginAccount) {
    return {
      allowed: false,
      reason: 'This spread type requires a margin account',
    };
  }

  // Check specific capabilities
  switch (spreadSubtype) {
    case 'call_debit_spread':
    case 'call_credit_spread':
    case 'put_debit_spread':
    case 'put_credit_spread':
      if (!capabilities.canTradeVerticalSpreads) {
        return {
          allowed: false,
          reason: 'Account not approved for vertical spreads',
        };
      }
      break;

    case 'call_calendar':
    case 'put_calendar':
      if (!capabilities.canTradeCalendarSpreads) {
        return {
          allowed: false,
          reason: 'Account not approved for calendar spreads',
        };
      }
      break;

    case 'iron_condor':
    case 'iron_butterfly':
      if (!capabilities.canTradeIronCondors) {
        return {
          allowed: false,
          reason: 'Account not approved for iron condors/butterflies',
        };
      }
      break;

    case 'short_straddle':
    case 'short_strangle':
      if (!capabilities.canSellNakedOptions) {
        return {
          allowed: false,
          reason: 'Account not approved for selling naked options',
        };
      }
      break;
  }

  return { allowed: true };
}

/**
 * Convert ProposalContracts to SpreadLegs
 */
export function contractsToSpreadLegs(contracts: ProposalContract[]): SpreadLeg[] {
  return contracts.map((contract, index) => ({
    legIndex: index,
    optionSymbol: contract.optionSymbol,
    underlying: contract.underlying,
    strike: contract.strike,
    expiration: contract.expiration,
    optionType: contract.optionType,
    side: contract.side,
    quantity: contract.quantity,
    ratio: 1, // Default ratio, can be adjusted for ratio spreads
  }));
}

/**
 * Create default broker capabilities for testing
 */
export function createDefaultCapabilities(level: OptionsLevel = 3): BrokerOptionsCapabilities {
  return {
    optionsLevel: level,
    canTradeSingleLeg: level >= 1,
    canTradeVerticalSpreads: level >= 2,
    canTradeCalendarSpreads: level >= 3,
    canTradeIronCondors: level >= 3,
    canSellNakedOptions: level >= 4,
    supportsAtomicMultiLeg: true,
    isMarginAccount: level >= 2,
    description: `Options trading level ${level}`,
  };
}

/**
 * Format spread subtype for display
 */
export function formatSpreadSubtype(subtype: SpreadSubtype): string {
  const names: Record<SpreadSubtype, string> = {
    call_debit_spread: 'Call Debit Spread',
    call_credit_spread: 'Call Credit Spread',
    put_debit_spread: 'Put Debit Spread',
    put_credit_spread: 'Put Credit Spread',
    call_calendar: 'Call Calendar Spread',
    put_calendar: 'Put Calendar Spread',
    iron_condor: 'Iron Condor',
    iron_butterfly: 'Iron Butterfly',
    long_straddle: 'Long Straddle',
    short_straddle: 'Short Straddle',
    long_strangle: 'Long Strangle',
    short_strangle: 'Short Strangle',
    custom: 'Custom Strategy',
  };
  return names[subtype] || subtype;
}

/**
 * Check if a strategy type is a multi-leg spread
 */
export function isMultiLegStrategy(strategyType: StrategyType): boolean {
  const multiLegStrategies: StrategyType[] = [
    'vertical_spread',
    'calendar_spread',
    'iron_condor',
    'straddle',
    'strangle',
  ];
  return multiLegStrategies.includes(strategyType);
}

/**
 * Get the number of legs expected for a strategy type
 */
export function getExpectedLegCount(strategyType: StrategyType): number {
  switch (strategyType) {
    case 'vertical_spread':
    case 'straddle':
    case 'strangle':
      return 2;
    case 'calendar_spread':
      return 2;
    case 'iron_condor':
      return 4;
    default:
      return 1;
  }
}
