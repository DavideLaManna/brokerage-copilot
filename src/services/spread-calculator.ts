/**
 * Spread Calculator Service
 *
 * Calculates risk metrics for multi-leg option spread strategies.
 * Provides accurate max loss, max profit, and break-even calculations
 * for various spread types.
 */

import type { Position, AccountSummary, Quote, OptionContract } from '../types/broker.js';
import type { TradeProposal, ProposalContract, StrategyType } from '../types/trade-proposal.js';
import type {
  SpreadDefinition,
  SpreadLeg,
  SpreadRiskMetrics,
  SpreadSubtype,
  BrokerOptionsCapabilities,
} from '../types/spreads.js';
import {
  determineSpreadSubtype,
  contractsToSpreadLegs,
  canTradeSpread,
  getSpreadCapabilityRequirements,
} from '../types/spreads.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Context for spread calculations
 */
export interface SpreadCalculationContext {
  /** Account summary for position sizing */
  account?: AccountSummary;
  /** Current positions for exposure calculation */
  positions?: Position[];
  /** Quotes for the legs (keyed by option symbol) */
  quotes?: Map<string, Quote | OptionContract>;
  /** Broker capabilities for validation */
  capabilities?: BrokerOptionsCapabilities;
}

/**
 * Result of spread validation
 */
export interface SpreadValidationResult {
  /** Whether the spread is valid for trading */
  valid: boolean;
  /** Errors that prevent trading */
  errors: string[];
  /** Warnings to consider */
  warnings: string[];
  /** Risk metrics if calculable */
  riskMetrics?: SpreadRiskMetrics;
  /** Spread definition */
  spread?: SpreadDefinition;
}

// ============================================================================
// Spread Risk Calculation Functions
// ============================================================================

/**
 * Calculate the width of a vertical spread
 */
export function calculateSpreadWidth(legs: SpreadLeg[]): number | undefined {
  if (legs.length !== 2) return undefined;

  const strikes = legs.map(l => l.strike).sort((a, b) => a - b);
  return Math.abs(strikes[1]! - strikes[0]!);
}

/**
 * Calculate net premium for a spread (positive = debit, negative = credit)
 */
export function calculateNetPremium(
  legs: SpreadLeg[],
  legPrices: Map<string, number>,
  multiplier: number = 100
): number {
  let netPremium = 0;

  for (const leg of legs) {
    const price = legPrices.get(leg.optionSymbol) ?? 0;
    const legValue = price * leg.quantity * multiplier;

    if (leg.side === 'buy') {
      netPremium += legValue; // Paying for long legs
    } else {
      netPremium -= legValue; // Receiving for short legs
    }
  }

  return netPremium;
}

/**
 * Calculate risk metrics for a vertical spread (2-leg debit or credit)
 */
export function calculateVerticalSpreadRisk(
  legs: SpreadLeg[],
  netPremium: number,
  multiplier: number = 100
): SpreadRiskMetrics {
  if (legs.length !== 2) {
    throw new Error('Vertical spread must have exactly 2 legs');
  }

  const width = calculateSpreadWidth(legs)!;
  const maxWidth = width * multiplier * Math.min(legs[0]!.quantity, legs[1]!.quantity);
  const absNetPremium = Math.abs(netPremium);

  // For debit spreads: max loss = premium paid, max profit = width - premium
  // For credit spreads: max loss = width - premium, max profit = premium received
  const isDebit = netPremium > 0;

  let maxLoss: number;
  let maxProfit: number;
  let breakEvenPrices: number[];

  if (isDebit) {
    maxLoss = absNetPremium;
    maxProfit = maxWidth - absNetPremium;
  } else {
    maxLoss = maxWidth - absNetPremium;
    maxProfit = absNetPremium;
  }

  // Calculate break-even prices
  const longLeg = legs.find(l => l.side === 'buy')!;
  const shortLeg = legs.find(l => l.side === 'sell')!;
  const premiumPerContract = absNetPremium / (multiplier * Math.min(legs[0]!.quantity, legs[1]!.quantity));

  if (longLeg.optionType === 'call') {
    if (isDebit) {
      // Call debit spread: BE = long strike + premium
      breakEvenPrices = [longLeg.strike + premiumPerContract];
    } else {
      // Call credit spread: BE = short strike + premium
      breakEvenPrices = [shortLeg.strike + premiumPerContract];
    }
  } else {
    if (isDebit) {
      // Put debit spread: BE = long strike - premium
      breakEvenPrices = [longLeg.strike - premiumPerContract];
    } else {
      // Put credit spread: BE = short strike - premium
      breakEvenPrices = [shortLeg.strike - premiumPerContract];
    }
  }

  const riskRewardRatio = maxProfit > 0 ? maxLoss / maxProfit : Infinity;

  return {
    maxLoss,
    maxProfit,
    riskRewardRatio,
    breakEvenPrices,
    netPremium,
    isDefinedRisk: true,
    riskDescription: isDebit
      ? `Debit spread with defined risk of ${formatCurrency(maxLoss)}`
      : `Credit spread with defined risk of ${formatCurrency(maxLoss)}`,
  };
}

/**
 * Calculate risk metrics for an iron condor (4 legs)
 */
export function calculateIronCondorRisk(
  legs: SpreadLeg[],
  netPremium: number,
  multiplier: number = 100
): SpreadRiskMetrics {
  if (legs.length !== 4) {
    throw new Error('Iron condor must have exactly 4 legs');
  }

  const puts = legs.filter(l => l.optionType === 'put').sort((a, b) => a.strike - b.strike);
  const calls = legs.filter(l => l.optionType === 'call').sort((a, b) => a.strike - b.strike);

  if (puts.length !== 2 || calls.length !== 2) {
    throw new Error('Iron condor must have 2 puts and 2 calls');
  }

  // Calculate width of each side
  const putWidth = Math.abs(puts[1]!.strike - puts[0]!.strike);
  const callWidth = Math.abs(calls[1]!.strike - calls[0]!.strike);
  const maxWidthSide = Math.max(putWidth, callWidth);

  // For iron condor: max loss = wider side width - net credit
  // max profit = net credit received
  const absNetPremium = Math.abs(netPremium);
  const quantity = Math.min(...legs.map(l => l.quantity));
  const maxWidth = maxWidthSide * multiplier * quantity;

  // Iron condors are typically sold for a credit
  const maxLoss = maxWidth - absNetPremium;
  const maxProfit = absNetPremium;

  // Break-even prices: short put strike - credit/contracts, short call strike + credit/contracts
  const shortPut = puts.find(p => p.side === 'sell')!;
  const shortCall = calls.find(c => c.side === 'sell')!;
  const premiumPerContract = absNetPremium / (multiplier * quantity);

  const breakEvenPrices = [
    shortPut.strike - premiumPerContract,
    shortCall.strike + premiumPerContract,
  ];

  return {
    maxLoss,
    maxProfit,
    riskRewardRatio: maxProfit > 0 ? maxLoss / maxProfit : Infinity,
    breakEvenPrices,
    netPremium,
    isDefinedRisk: true,
    riskDescription: `Iron condor with max risk of ${formatCurrency(maxLoss)}`,
  };
}

/**
 * Calculate risk metrics for a straddle or strangle
 */
export function calculateStraddleStrangleRisk(
  legs: SpreadLeg[],
  netPremium: number,
  multiplier: number = 100
): SpreadRiskMetrics {
  if (legs.length !== 2) {
    throw new Error('Straddle/strangle must have exactly 2 legs');
  }

  const callLeg = legs.find(l => l.optionType === 'call')!;
  const putLeg = legs.find(l => l.optionType === 'put')!;

  if (!callLeg || !putLeg) {
    throw new Error('Straddle/strangle must have one call and one put');
  }

  const absNetPremium = Math.abs(netPremium);
  const quantity = Math.min(callLeg.quantity, putLeg.quantity);
  const isLong = callLeg.side === 'buy' && putLeg.side === 'buy';

  let maxLoss: number;
  let maxProfit: number;
  let isDefinedRisk: boolean;
  let riskDescription: string;

  if (isLong) {
    // Long straddle/strangle: max loss = premium paid, max profit = unlimited
    maxLoss = absNetPremium;
    maxProfit = Infinity;
    isDefinedRisk = true;
    riskDescription = `Long position with defined risk of ${formatCurrency(maxLoss)}`;
  } else {
    // Short straddle/strangle: max loss = unlimited, max profit = premium received
    maxLoss = Infinity;
    maxProfit = absNetPremium;
    isDefinedRisk = false;
    riskDescription = 'Short position with UNDEFINED risk (theoretically unlimited)';
  }

  // Break-even prices
  const premiumPerContract = absNetPremium / (multiplier * quantity);
  const breakEvenPrices = [
    putLeg.strike - premiumPerContract,
    callLeg.strike + premiumPerContract,
  ];

  return {
    maxLoss,
    maxProfit,
    riskRewardRatio: maxProfit > 0 && maxProfit !== Infinity ? maxLoss / maxProfit : Infinity,
    breakEvenPrices,
    netPremium,
    isDefinedRisk,
    riskDescription,
  };
}

/**
 * Calculate risk metrics for a calendar spread
 */
export function calculateCalendarSpreadRisk(
  legs: SpreadLeg[],
  netPremium: number,
  _multiplier: number = 100
): SpreadRiskMetrics {
  // Calendar spreads have complex risk profiles that depend on volatility
  // Max loss is typically limited to the net debit paid
  // Max profit is variable and occurs when the underlying is at the strike at front expiration

  const absNetPremium = Math.abs(netPremium);
  const isDebit = netPremium > 0;

  // For a debit calendar, max loss is the debit paid
  // For a credit calendar (unusual), risk is more complex
  const maxLoss = isDebit ? absNetPremium : absNetPremium * 2; // Conservative estimate for credit
  const maxProfit = absNetPremium * 0.5; // Conservative estimate (varies with IV)

  const strike = legs[0]?.strike ?? 0;

  return {
    maxLoss,
    maxProfit,
    riskRewardRatio: maxProfit > 0 ? maxLoss / maxProfit : Infinity,
    breakEvenPrices: [strike], // Simplified - actual BEs depend on IV
    netPremium,
    isDefinedRisk: isDebit,
    riskDescription: isDebit
      ? `Calendar spread with defined risk of ${formatCurrency(maxLoss)} (max)`
      : 'Calendar spread with variable risk profile',
  };
}

/**
 * Calculate risk metrics for a single-leg option
 */
export function calculateSingleLegRisk(
  leg: SpreadLeg,
  price: number,
  multiplier: number = 100
): SpreadRiskMetrics {
  const premium = price * leg.quantity * multiplier;

  if (leg.side === 'buy') {
    // Long option: max loss = premium, max profit = unlimited for calls
    return {
      maxLoss: premium,
      maxProfit: leg.optionType === 'call' ? Infinity : leg.strike * multiplier * leg.quantity - premium,
      riskRewardRatio: Infinity,
      breakEvenPrices: [leg.optionType === 'call' ? leg.strike + price : leg.strike - price],
      netPremium: premium,
      isDefinedRisk: true,
      riskDescription: `Long ${leg.optionType} with defined risk of ${formatCurrency(premium)}`,
    };
  } else {
    // Short option: max loss = unlimited for calls, strike value for puts
    const maxLoss = leg.optionType === 'call'
      ? Infinity
      : leg.strike * multiplier * leg.quantity - premium;

    return {
      maxLoss,
      maxProfit: premium,
      riskRewardRatio: maxLoss !== Infinity ? maxLoss / premium : Infinity,
      breakEvenPrices: [leg.optionType === 'call' ? leg.strike + price : leg.strike - price],
      netPremium: -premium,
      isDefinedRisk: leg.optionType === 'put',
      riskDescription: leg.optionType === 'call'
        ? 'Short call with UNDEFINED risk (theoretically unlimited)'
        : `Short put with defined risk of ${formatCurrency(maxLoss)}`,
    };
  }
}

// ============================================================================
// Main Calculator Functions
// ============================================================================

/**
 * Calculate risk metrics for any spread type
 */
export function calculateSpreadRiskMetrics(
  spread: SpreadDefinition,
  context?: SpreadCalculationContext
): SpreadRiskMetrics {
  const { legs, netPremium, multiplier, spreadSubtype } = spread;

  // Get leg prices from context if available
  const legPrices = new Map<string, number>();
  if (context?.quotes) {
    for (const leg of legs) {
      const quote = context.quotes.get(leg.optionSymbol);
      if (quote) {
        legPrices.set(leg.optionSymbol, (quote.bid + quote.ask) / 2);
      }
    }
  }

  // Use provided net premium or calculate from prices
  const calculatedPremium = legPrices.size === legs.length
    ? calculateNetPremium(legs, legPrices, multiplier)
    : netPremium;

  // Route to specific calculator based on spread type
  switch (spreadSubtype) {
    case 'call_debit_spread':
    case 'call_credit_spread':
    case 'put_debit_spread':
    case 'put_credit_spread':
      return calculateVerticalSpreadRisk(legs, calculatedPremium, multiplier);

    case 'iron_condor':
    case 'iron_butterfly':
      return calculateIronCondorRisk(legs, calculatedPremium, multiplier);

    case 'long_straddle':
    case 'short_straddle':
    case 'long_strangle':
    case 'short_strangle':
      return calculateStraddleStrangleRisk(legs, calculatedPremium, multiplier);

    case 'call_calendar':
    case 'put_calendar':
      return calculateCalendarSpreadRisk(legs, calculatedPremium, multiplier);

    default:
      // For custom or single-leg, calculate based on legs
      if (legs.length === 1) {
        const leg = legs[0]!;
        const price = legPrices.get(leg.optionSymbol) ?? Math.abs(calculatedPremium) / (multiplier * leg.quantity);
        return calculateSingleLegRisk(leg, price, multiplier);
      }

      // Custom multi-leg: conservative estimate
      return {
        maxLoss: Math.abs(calculatedPremium) * 2, // Conservative estimate
        maxProfit: Math.abs(calculatedPremium),
        riskRewardRatio: 2,
        breakEvenPrices: [],
        netPremium: calculatedPremium,
        isDefinedRisk: false,
        riskDescription: 'Custom strategy - review risk manually',
      };
  }
}

/**
 * Create a SpreadDefinition from a TradeProposal
 */
export function createSpreadFromProposal(
  proposal: TradeProposal,
  legPrices?: Map<string, number>
): SpreadDefinition {
  const legs = contractsToSpreadLegs(proposal.contracts);
  const multiplier = 100; // Standard option multiplier

  // Calculate net premium from target prices or provided prices
  let netPremium = 0;
  for (const contract of proposal.contracts) {
    const price = legPrices?.get(contract.optionSymbol) ?? contract.targetPrice ?? 0;
    const legValue = price * contract.quantity * multiplier;
    netPremium += contract.side === 'buy' ? legValue : -legValue;
  }

  const spreadSubtype = determineSpreadSubtype(proposal.strategyType, legs);
  const spreadWidth = calculateSpreadWidth(legs);
  const quantity = Math.min(...legs.map(l => l.quantity));

  return {
    strategyType: proposal.strategyType,
    spreadSubtype,
    underlying: proposal.underlying,
    legs,
    isDebit: netPremium > 0,
    netPremium,
    spreadWidth,
    quantity,
    multiplier,
  };
}

/**
 * Validate a spread for trading
 */
export function validateSpread(
  proposal: TradeProposal,
  context: SpreadCalculationContext
): SpreadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Create spread definition
  const spread = createSpreadFromProposal(proposal);

  // Check capabilities if provided
  if (context.capabilities) {
    const capabilityCheck = canTradeSpread(context.capabilities, spread.spreadSubtype);
    if (!capabilityCheck.allowed) {
      errors.push(capabilityCheck.reason!);
    }
  }

  // Validate leg count matches strategy type
  const expectedLegCount = getExpectedLegCountForStrategy(proposal.strategyType);
  if (expectedLegCount !== -1 && spread.legs.length !== expectedLegCount) {
    errors.push(
      `${proposal.strategyType} expects ${expectedLegCount} legs, but ${spread.legs.length} provided`
    );
  }

  // Validate legs have consistent underlying
  const underlyings = new Set(spread.legs.map(l => l.underlying));
  if (underlyings.size > 1) {
    errors.push(`All legs must have the same underlying, found: ${Array.from(underlyings).join(', ')}`);
  }

  // Validate quantities are balanced (for standard spreads)
  if (spread.legs.length > 1) {
    const quantities = spread.legs.map(l => l.quantity);
    const uniqueQuantities = new Set(quantities);
    if (uniqueQuantities.size > 1) {
      warnings.push('Legs have different quantities - ensure this is intentional for ratio spreads');
    }
  }

  // Calculate risk metrics
  let riskMetrics: SpreadRiskMetrics | undefined;
  try {
    riskMetrics = calculateSpreadRiskMetrics(spread, context);

    // Add warnings for undefined risk
    if (!riskMetrics.isDefinedRisk) {
      warnings.push('This strategy has UNDEFINED risk - ensure you understand the potential losses');
    }

    // Add warning for high max loss
    if (context.account && riskMetrics.maxLoss !== Infinity) {
      const maxLossPercent = (riskMetrics.maxLoss / context.account.netLiquidation) * 100;
      if (maxLossPercent > 10) {
        warnings.push(
          `Max loss of ${formatCurrency(riskMetrics.maxLoss)} is ${maxLossPercent.toFixed(1)}% of account`
        );
      }
    }
  } catch (error) {
    errors.push(`Failed to calculate risk metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    riskMetrics,
    spread,
  };
}

/**
 * Get expected leg count for a strategy type
 */
function getExpectedLegCountForStrategy(strategyType: StrategyType): number {
  switch (strategyType) {
    case 'long_call':
    case 'long_put':
    case 'short_call':
    case 'short_put':
    case 'covered_call':
    case 'cash_secured_put':
      return 1;
    case 'vertical_spread':
    case 'straddle':
    case 'strangle':
    case 'calendar_spread':
      return 2;
    case 'iron_condor':
      return 4;
    default:
      return -1; // No specific expectation
  }
}

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
  if (value === Infinity) return 'Unlimited';
  const absValue = Math.abs(value);
  return `$${absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ============================================================================
// Exported Calculator Class
// ============================================================================

/**
 * SpreadCalculator service class for calculating spread risk metrics
 */
export class SpreadCalculator {
  private defaultMultiplier: number;

  constructor(config?: { defaultMultiplier?: number }) {
    this.defaultMultiplier = config?.defaultMultiplier ?? 100;
  }

  /**
   * Calculate risk metrics for a trade proposal
   */
  calculateProposalRisk(
    proposal: TradeProposal,
    context?: SpreadCalculationContext
  ): SpreadRiskMetrics {
    const spread = createSpreadFromProposal(proposal);
    return calculateSpreadRiskMetrics(spread, context);
  }

  /**
   * Validate a trade proposal for spread trading
   */
  validateProposal(
    proposal: TradeProposal,
    context: SpreadCalculationContext
  ): SpreadValidationResult {
    return validateSpread(proposal, context);
  }

  /**
   * Create a spread definition from a proposal
   */
  createSpreadDefinition(
    proposal: TradeProposal,
    legPrices?: Map<string, number>
  ): SpreadDefinition {
    return createSpreadFromProposal(proposal, legPrices);
  }

  /**
   * Calculate max loss for a proposal (convenience method for RiskEngine)
   */
  calculateMaxLoss(proposal: TradeProposal, context?: SpreadCalculationContext): number {
    const metrics = this.calculateProposalRisk(proposal, context);
    // For undefined risk strategies, use absolute net premium * 10 as conservative estimate
    return metrics.maxLoss === Infinity ? Math.abs(metrics.netPremium) * 10 : metrics.maxLoss;
  }
}

/**
 * Create a SpreadCalculator instance
 */
export function createSpreadCalculator(config?: { defaultMultiplier?: number }): SpreadCalculator {
  return new SpreadCalculator(config);
}
