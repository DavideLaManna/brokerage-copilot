/**
 * Risk Engine - Pre-Trade Validation
 *
 * Validates orders against risk configuration and current portfolio state.
 * Blocks orders that violate risk limits to prevent over-leveraging.
 * Supports both single-leg and multi-leg spread strategies.
 */

import type {
  OrderRequest,
  Position,
  AccountSummary,
  Quote,
  OptionContract,
  Greeks,
} from '../types/broker.js';
import type { RiskConfig } from '../types/risk-config.js';
import type { TradeProposal } from '../types/trade-proposal.js';
import type { BrokerOptionsCapabilities, SpreadRiskMetrics } from '../types/spreads.js';
import { canTradeSpread, isMultiLegStrategy } from '../types/spreads.js';
import {
  createSpreadFromProposal,
  calculateSpreadRiskMetrics,
} from './spread-calculator.js';

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Types of risk validation checks
 */
export type RiskCheckType =
  | 'risk_per_trade'
  | 'concentration'
  | 'buying_power'
  | 'dte_range'
  | 'liquidity'
  | 'max_positions'
  | 'max_contracts'
  | 'spread_capability'
  | 'spread_structure';

/**
 * Result of a single risk check
 */
export interface RiskCheckResult {
  /** Type of check performed */
  checkType: RiskCheckType;
  /** Whether the check passed */
  passed: boolean;
  /** Human-readable message explaining the result */
  message: string;
  /** Additional details about the check */
  details?: {
    /** Actual value that was checked */
    actual?: number;
    /** Limit that was applied */
    limit?: number;
    /** Unit of measurement (%, $, contracts, days, etc.) */
    unit?: string;
  };
}

/**
 * Complete result of order validation
 */
export interface OrderValidationResult {
  /** Whether the order passed all risk checks */
  valid: boolean;
  /** Individual check results */
  checks: RiskCheckResult[];
  /** Summary of failed checks (empty if valid) */
  rejectionReasons: string[];
  /** Timestamp of validation */
  validatedAt: Date;
  /** Order that was validated (for audit) */
  order: OrderRequest;
}

/**
 * Context required for validating an order
 */
export interface ValidationContext {
  /** Risk configuration to validate against */
  config: RiskConfig;
  /** Current account summary (for buying power check) */
  account: AccountSummary;
  /** Current open positions */
  positions: Position[];
  /** Quote for the option contract (for liquidity check) */
  quote?: Quote | OptionContract;
  /** Quotes for multiple legs (keyed by option symbol) */
  legQuotes?: Map<string, Quote | OptionContract>;
  /** Broker options capabilities (for spread validation) */
  capabilities?: BrokerOptionsCapabilities;
}

/**
 * Result of validating a spread/proposal
 */
export interface SpreadValidationResult {
  /** Whether the spread passed all risk checks */
  valid: boolean;
  /** Individual check results */
  checks: RiskCheckResult[];
  /** Summary of failed checks */
  rejectionReasons: string[];
  /** Timestamp of validation */
  validatedAt: Date;
  /** The proposal that was validated */
  proposal: TradeProposal;
  /** Calculated spread risk metrics */
  riskMetrics?: SpreadRiskMetrics;
}

/**
 * Logger interface for audit logging
 */
export interface RiskEngineLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Default console logger
 */
const defaultLogger: RiskEngineLogger = {
  info: (message, data) => console.log(`[RiskEngine] INFO: ${message}`, data || ''),
  warn: (message, data) => console.warn(`[RiskEngine] WARN: ${message}`, data || ''),
  error: (message, data) => console.error(`[RiskEngine] ERROR: ${message}`, data || ''),
};

// ============================================================================
// Risk Engine Configuration
// ============================================================================

export interface RiskEngineConfig {
  /** Logger for audit trail */
  logger?: RiskEngineLogger;
  /** Maximum bid-ask spread percentage before flagging as illiquid (default: 5%) */
  liquiditySpreadThreshold?: number;
}

// ============================================================================
// Risk Engine Class
// ============================================================================

/**
 * RiskEngine - Pre-trade validation service
 *
 * Validates orders against user risk configuration and current portfolio state.
 * All validation attempts are logged for audit purposes.
 */
export class RiskEngine {
  private logger: RiskEngineLogger;
  private liquiditySpreadThreshold: number;

  constructor(config: RiskEngineConfig = {}) {
    this.logger = config.logger || defaultLogger;
    this.liquiditySpreadThreshold = config.liquiditySpreadThreshold ?? 5; // 5% default
  }

  /**
   * Validate an order against risk configuration and current portfolio state.
   *
   * @param order - The order to validate
   * @param context - Validation context (config, account, positions, quote)
   * @returns Validation result with pass/fail status and detailed check results
   */
  validateOrder(order: OrderRequest, context: ValidationContext): OrderValidationResult {
    const checks: RiskCheckResult[] = [];
    const validatedAt = new Date();

    // Run all checks
    checks.push(this.checkRiskPerTrade(order, context));
    checks.push(this.checkConcentration(order, context));
    checks.push(this.checkBuyingPower(order, context));
    checks.push(this.checkMaxPositions(order, context));
    checks.push(this.checkMaxContracts(order, context));

    // Option-specific checks
    if (order.assetClass === 'option' && order.optionDetails) {
      checks.push(this.checkDTERange(order, context));
    }

    // Liquidity check (if quote available)
    if (context.quote) {
      checks.push(this.checkLiquidity(order, context));
    }

    // Compile results
    const failedChecks = checks.filter((c) => !c.passed);
    const valid = failedChecks.length === 0;
    const rejectionReasons = failedChecks.map((c) => c.message);

    const result: OrderValidationResult = {
      valid,
      checks,
      rejectionReasons,
      validatedAt,
      order,
    };

    // Log validation attempt
    this.logValidation(result, context);

    return result;
  }

  // ===========================================================================
  // Individual Risk Checks
  // ===========================================================================

  /**
   * Check if the order risk exceeds the max risk per trade limit.
   *
   * For options: risk = max loss = premium * quantity * multiplier
   * For buying options: max loss is the premium paid
   * For selling options: max loss can be unlimited (we use margin requirement as proxy)
   */
  private checkRiskPerTrade(order: OrderRequest, context: ValidationContext): RiskCheckResult {
    const { config, account } = context;
    const checkType: RiskCheckType = 'risk_per_trade';

    // Calculate estimated max loss for this trade
    const maxLoss = this.calculateMaxLoss(order, context);
    const accountValue = account.netLiquidation;

    // Avoid division by zero
    if (accountValue <= 0) {
      return {
        checkType,
        passed: false,
        message: 'Cannot validate risk: account value is zero or negative',
      };
    }

    const riskPercent = (maxLoss / accountValue) * 100;
    const limit = config.maxRiskPerTradePercent;
    const passed = riskPercent <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Risk per trade ${riskPercent.toFixed(2)}% is within ${limit}% limit`
        : `Risk per trade ${riskPercent.toFixed(2)}% exceeds ${limit}% limit`,
      details: {
        actual: riskPercent,
        limit,
        unit: '%',
      },
    };
  }

  /**
   * Check if adding this position would exceed the concentration limit for the underlying.
   */
  private checkConcentration(order: OrderRequest, context: ValidationContext): RiskCheckResult {
    const { config, account, positions } = context;
    const checkType: RiskCheckType = 'concentration';

    // Get the underlying symbol
    const underlying =
      order.assetClass === 'option' && order.optionDetails
        ? order.optionDetails.underlying
        : order.symbol;

    // Calculate current exposure to this underlying
    const currentExposure = this.calculateUnderlyingExposure(underlying, positions);

    // Calculate new exposure from this order
    const newExposure = this.calculateMaxLoss(order, context);
    const totalExposure = currentExposure + newExposure;

    const accountValue = account.netLiquidation;

    // Avoid division by zero
    if (accountValue <= 0) {
      return {
        checkType,
        passed: false,
        message: 'Cannot validate concentration: account value is zero or negative',
      };
    }

    const concentrationPercent = (totalExposure / accountValue) * 100;
    const limit = config.maxRiskPerUnderlyingPercent;
    const passed = concentrationPercent <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Concentration in ${underlying} (${concentrationPercent.toFixed(2)}%) is within ${limit}% limit`
        : `Concentration in ${underlying} (${concentrationPercent.toFixed(2)}%) exceeds ${limit}% limit`,
      details: {
        actual: concentrationPercent,
        limit,
        unit: '%',
      },
    };
  }

  /**
   * Check if account has sufficient buying power for the order.
   */
  private checkBuyingPower(order: OrderRequest, context: ValidationContext): RiskCheckResult {
    const { account } = context;
    const checkType: RiskCheckType = 'buying_power';

    // Calculate estimated cost/margin requirement
    const estimatedCost = this.calculateOrderCost(order, context);
    const availableBuyingPower = account.buyingPower;

    const passed = estimatedCost <= availableBuyingPower;

    return {
      checkType,
      passed,
      message: passed
        ? `Order cost $${estimatedCost.toFixed(2)} is within buying power $${availableBuyingPower.toFixed(2)}`
        : `Insufficient buying power: order requires $${estimatedCost.toFixed(2)}, available $${availableBuyingPower.toFixed(2)}`,
      details: {
        actual: estimatedCost,
        limit: availableBuyingPower,
        unit: '$',
      },
    };
  }

  /**
   * Check if the option DTE is within the allowed range.
   */
  private checkDTERange(order: OrderRequest, context: ValidationContext): RiskCheckResult {
    const { config } = context;
    const checkType: RiskCheckType = 'dte_range';

    if (!order.optionDetails?.expiration) {
      return {
        checkType,
        passed: false,
        message: 'Cannot validate DTE: option expiration not provided',
      };
    }

    const expiration = new Date(order.optionDetails.expiration);
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const dte = Math.floor((expiration.getTime() - now.getTime()) / msPerDay);

    const minDTE = config.minDTE;
    const maxDTE = config.maxDTE;

    if (dte < minDTE) {
      return {
        checkType,
        passed: false,
        message: `DTE ${dte} days is below minimum ${minDTE} days`,
        details: {
          actual: dte,
          limit: minDTE,
          unit: 'days',
        },
      };
    }

    if (dte > maxDTE) {
      return {
        checkType,
        passed: false,
        message: `DTE ${dte} days exceeds maximum ${maxDTE} days`,
        details: {
          actual: dte,
          limit: maxDTE,
          unit: 'days',
        },
      };
    }

    return {
      checkType,
      passed: true,
      message: `DTE ${dte} days is within ${minDTE}-${maxDTE} day range`,
      details: {
        actual: dte,
        limit: maxDTE,
        unit: 'days',
      },
    };
  }

  /**
   * Check if the contract has sufficient liquidity (bid-ask spread).
   */
  private checkLiquidity(order: OrderRequest, context: ValidationContext): RiskCheckResult {
    const checkType: RiskCheckType = 'liquidity';

    const quote = context.quote;
    if (!quote) {
      return {
        checkType,
        passed: true, // Pass if no quote available (will be checked elsewhere)
        message: 'Liquidity check skipped: no quote available',
      };
    }

    const bid = quote.bid;
    const ask = quote.ask;

    // Can't calculate spread if bid or ask is zero
    if (bid <= 0 || ask <= 0) {
      return {
        checkType,
        passed: false,
        message: 'Low liquidity warning: bid or ask price is zero',
        details: {
          actual: 0,
          limit: this.liquiditySpreadThreshold,
          unit: '%',
        },
      };
    }

    const mid = (bid + ask) / 2;
    const spreadPercent = ((ask - bid) / mid) * 100;
    const limit = this.liquiditySpreadThreshold;
    const passed = spreadPercent <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Bid-ask spread ${spreadPercent.toFixed(2)}% is within ${limit}% threshold`
        : `Low liquidity: bid-ask spread ${spreadPercent.toFixed(2)}% exceeds ${limit}% threshold`,
      details: {
        actual: spreadPercent,
        limit,
        unit: '%',
      },
    };
  }

  /**
   * Check if adding this position would exceed the max open positions limit.
   */
  private checkMaxPositions(order: OrderRequest, context: ValidationContext): RiskCheckResult {
    const { config, positions } = context;
    const checkType: RiskCheckType = 'max_positions';

    // Count current open positions
    const currentPositions = positions.filter((p) => p.quantity !== 0).length;

    // Check if this is a new position or adding to existing
    const underlying =
      order.assetClass === 'option' && order.optionDetails
        ? order.optionDetails.underlying
        : order.symbol;

    const isNewPosition = !positions.some((p) => {
      const posUnderlying =
        p.assetClass === 'option' && p.optionDetails ? p.optionDetails.underlying : p.symbol;
      return posUnderlying === underlying;
    });

    const projectedPositions = isNewPosition ? currentPositions + 1 : currentPositions;
    const limit = config.maxOpenPositions;
    const passed = projectedPositions <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Position count ${projectedPositions} is within ${limit} position limit`
        : `Max positions exceeded: ${projectedPositions} positions would exceed ${limit} limit`,
      details: {
        actual: projectedPositions,
        limit,
        unit: 'positions',
      },
    };
  }

  /**
   * Check if the order quantity exceeds max contracts per position.
   */
  private checkMaxContracts(order: OrderRequest, context: ValidationContext): RiskCheckResult {
    const { config, positions } = context;
    const checkType: RiskCheckType = 'max_contracts';

    // For equities, this check doesn't apply the same way - pass it
    if (order.assetClass !== 'option') {
      return {
        checkType,
        passed: true,
        message: 'Max contracts check applies only to options',
      };
    }

    // Get current position in this specific contract
    const existingPosition = positions.find(
      (p) => p.symbol === order.symbol || p.optionDetails?.optionSymbol === order.symbol
    );

    const currentQuantity = existingPosition ? Math.abs(existingPosition.quantity) : 0;
    const orderQuantity = order.quantity;

    // For buy orders, add to position; for sell, depends on if closing or opening
    let projectedQuantity: number;
    if (existingPosition) {
      if (
        (existingPosition.quantity > 0 && order.side === 'buy') ||
        (existingPosition.quantity < 0 && order.side === 'sell')
      ) {
        // Adding to position
        projectedQuantity = currentQuantity + orderQuantity;
      } else {
        // Closing position
        projectedQuantity = Math.abs(currentQuantity - orderQuantity);
      }
    } else {
      // New position
      projectedQuantity = orderQuantity;
    }

    const limit = config.maxContractsPerPosition;
    const passed = projectedQuantity <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Contract count ${projectedQuantity} is within ${limit} contract limit`
        : `Max contracts exceeded: ${projectedQuantity} contracts would exceed ${limit} limit`,
      details: {
        actual: projectedQuantity,
        limit,
        unit: 'contracts',
      },
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Calculate the maximum potential loss for an order.
   *
   * For buying options: max loss = premium paid
   * For selling naked options: max loss is theoretically unlimited (use margin requirement)
   * For spreads: max loss = width of spread * contracts
   */
  private calculateMaxLoss(order: OrderRequest, context: ValidationContext): number {
    const multiplier = 100; // Standard option multiplier
    const quantity = order.quantity;

    // Use limit price or quote mid for premium estimate
    let premium = order.limitPrice;
    if (!premium && context.quote) {
      premium = (context.quote.bid + context.quote.ask) / 2;
    }
    if (!premium) {
      premium = 0;
    }

    if (order.assetClass === 'option') {
      if (order.side === 'buy') {
        // Buying options: max loss is the premium
        return premium * quantity * multiplier;
      } else {
        // Selling options: use premium as estimate (real max loss depends on strategy)
        // For naked puts: max loss = strike * multiplier * quantity
        // For naked calls: theoretically unlimited
        // We'll use 2x premium as a conservative estimate for simple validation
        return premium * quantity * multiplier * 2;
      }
    } else {
      // Equity: max loss = cost basis (for long positions)
      const price = premium || context.account.netLiquidation / 100; // Fallback
      if (order.side === 'buy') {
        return price * quantity;
      } else {
        // Short equity: theoretically unlimited, use position value as estimate
        return price * quantity;
      }
    }
  }

  /**
   * Calculate current risk exposure to an underlying symbol.
   */
  private calculateUnderlyingExposure(underlying: string, positions: Position[]): number {
    let totalExposure = 0;

    for (const position of positions) {
      const posUnderlying =
        position.assetClass === 'option' && position.optionDetails
          ? position.optionDetails.underlying
          : position.symbol;

      if (posUnderlying === underlying) {
        // Use absolute unrealized P&L as exposure measure
        // Or market value for a more comprehensive measure
        totalExposure += Math.abs(position.marketValue);
      }
    }

    return totalExposure;
  }

  /**
   * Calculate the cost/margin requirement for an order.
   */
  private calculateOrderCost(order: OrderRequest, context: ValidationContext): number {
    const multiplier = order.assetClass === 'option' ? 100 : 1;
    const quantity = order.quantity;

    // Use limit price or quote mid
    let price = order.limitPrice;
    if (!price && context.quote) {
      price = (context.quote.bid + context.quote.ask) / 2;
    }
    if (!price) {
      price = 0;
    }

    if (order.side === 'buy') {
      // Buying: cost = price * quantity * multiplier
      return price * quantity * multiplier;
    } else {
      // Selling: margin requirement varies by broker and strategy
      // Use 20% of notional as conservative estimate
      if (order.assetClass === 'option' && order.optionDetails) {
        const notional = order.optionDetails.strike * quantity * multiplier;
        return notional * 0.2; // 20% margin estimate
      }
      return price * quantity * multiplier;
    }
  }

  /**
   * Log validation attempt for audit trail.
   */
  private logValidation(result: OrderValidationResult, context: ValidationContext): void {
    const logData = {
      timestamp: result.validatedAt.toISOString(),
      valid: result.valid,
      order: {
        symbol: result.order.symbol,
        side: result.order.side,
        quantity: result.order.quantity,
        assetClass: result.order.assetClass,
        orderType: result.order.orderType,
      },
      accountId: 'audit', // Would come from context in production
      checksRun: result.checks.length,
      checksPassed: result.checks.filter((c) => c.passed).length,
      checksFailed: result.checks.filter((c) => !c.passed).length,
    };

    if (result.valid) {
      this.logger.info('Order validation PASSED', logData);
    } else {
      this.logger.warn('Order validation FAILED', {
        ...logData,
        rejectionReasons: result.rejectionReasons,
      });
    }
  }

  // ===========================================================================
  // Spread Validation Methods
  // ===========================================================================

  /**
   * Validate a multi-leg trade proposal (spread) against risk configuration.
   *
   * This method uses spread-aware risk calculations for accurate max loss
   * determination based on the spread structure.
   *
   * @param proposal - The trade proposal to validate
   * @param context - Validation context (config, account, positions, capabilities)
   * @returns Validation result with spread-specific metrics
   */
  validateSpread(proposal: TradeProposal, context: ValidationContext): SpreadValidationResult {
    const checks: RiskCheckResult[] = [];
    const validatedAt = new Date();

    // Create spread definition and calculate risk metrics
    let riskMetrics: SpreadRiskMetrics | undefined;
    try {
      const spread = createSpreadFromProposal(proposal);
      riskMetrics = calculateSpreadRiskMetrics(spread, {
        account: context.account,
        positions: context.positions,
        quotes: context.legQuotes,
        capabilities: context.capabilities,
      });

      // Check spread capability (broker account level)
      if (context.capabilities) {
        checks.push(this.checkSpreadCapability(spread.spreadSubtype, context.capabilities));
      }

      // Check spread structure
      checks.push(this.checkSpreadStructure(proposal, spread));

      // Check risk per trade using spread max loss
      checks.push(this.checkSpreadRiskPerTrade(riskMetrics.maxLoss, context));

      // Check concentration
      checks.push(this.checkSpreadConcentration(proposal.underlying, riskMetrics.maxLoss, context));

      // Check buying power using spread cost
      checks.push(this.checkSpreadBuyingPower(riskMetrics, context));

    } catch (error) {
      checks.push({
        checkType: 'spread_structure',
        passed: false,
        message: `Failed to analyze spread: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    // Check max positions
    checks.push(this.checkMaxPositionsForSpread(proposal, context));

    // Check max contracts per position
    checks.push(this.checkMaxContractsForSpread(proposal, context));

    // Check DTE for all legs
    for (let i = 0; i < proposal.contracts.length; i++) {
      const contract = proposal.contracts[i]!;
      const orderRequest: OrderRequest = {
        symbol: contract.optionSymbol,
        assetClass: 'option',
        side: contract.side,
        orderType: 'limit',
        timeInForce: 'day',
        quantity: contract.quantity,
        optionDetails: {
          underlying: contract.underlying,
          strike: contract.strike,
          expiration: contract.expiration,
          optionType: contract.optionType,
        },
      };
      const dteCheck = this.checkDTERange(orderRequest, context);
      if (!dteCheck.passed) {
        dteCheck.message = `Leg ${i + 1}: ${dteCheck.message}`;
        checks.push(dteCheck);
        break; // Only report first DTE failure
      }
    }

    // Check liquidity for all legs if quotes provided
    if (context.legQuotes) {
      for (let i = 0; i < proposal.contracts.length; i++) {
        const contract = proposal.contracts[i]!;
        const quote = context.legQuotes.get(contract.optionSymbol);
        if (quote) {
          const liquidityCheck = this.checkLiquidity(
            { symbol: contract.optionSymbol } as OrderRequest,
            { ...context, quote }
          );
          if (!liquidityCheck.passed) {
            liquidityCheck.message = `Leg ${i + 1}: ${liquidityCheck.message}`;
            checks.push(liquidityCheck);
          }
        }
      }
    }

    // Compile results
    const failedChecks = checks.filter((c) => !c.passed);
    const valid = failedChecks.length === 0;
    const rejectionReasons = failedChecks.map((c) => c.message);

    const result: SpreadValidationResult = {
      valid,
      checks,
      rejectionReasons,
      validatedAt,
      proposal,
      riskMetrics,
    };

    // Log validation
    this.logSpreadValidation(result, context);

    return result;
  }

  /**
   * Check if broker account has capability to trade this spread type.
   */
  private checkSpreadCapability(
    spreadSubtype: string,
    capabilities: BrokerOptionsCapabilities
  ): RiskCheckResult {
    const checkType: RiskCheckType = 'spread_capability';

    const result = canTradeSpread(capabilities, spreadSubtype as any);

    return {
      checkType,
      passed: result.allowed,
      message: result.allowed
        ? `Account has capability to trade ${spreadSubtype}`
        : result.reason || 'Account lacks spread trading capability',
      details: {
        actual: capabilities.optionsLevel,
        limit: 2, // Minimum for spreads
        unit: 'level',
      },
    };
  }

  /**
   * Check if the spread structure is valid.
   */
  private checkSpreadStructure(
    proposal: TradeProposal,
    spread: { spreadSubtype: string; legs: any[] }
  ): RiskCheckResult {
    const checkType: RiskCheckType = 'spread_structure';

    // Validate leg count matches strategy
    const isMultiLeg = isMultiLegStrategy(proposal.strategyType);
    const hasMultipleLegs = spread.legs.length > 1;

    if (isMultiLeg && !hasMultipleLegs) {
      return {
        checkType,
        passed: false,
        message: `${proposal.strategyType} requires multiple legs, but only ${spread.legs.length} provided`,
      };
    }

    // Check all legs have same underlying
    const underlyings = new Set(proposal.contracts.map(c => c.underlying));
    if (underlyings.size > 1) {
      return {
        checkType,
        passed: false,
        message: `All legs must have same underlying, found: ${Array.from(underlyings).join(', ')}`,
      };
    }

    return {
      checkType,
      passed: true,
      message: `Valid ${spread.spreadSubtype} structure with ${spread.legs.length} legs`,
    };
  }

  /**
   * Check risk per trade for a spread using calculated max loss.
   */
  private checkSpreadRiskPerTrade(maxLoss: number, context: ValidationContext): RiskCheckResult {
    const checkType: RiskCheckType = 'risk_per_trade';
    const { config, account } = context;

    if (account.netLiquidation <= 0) {
      return {
        checkType,
        passed: false,
        message: 'Cannot validate risk: account value is zero or negative',
      };
    }

    // Handle undefined/infinite max loss
    if (maxLoss === Infinity) {
      return {
        checkType,
        passed: false,
        message: 'Spread has undefined risk (theoretically unlimited loss)',
        details: {
          actual: Infinity,
          limit: config.maxRiskPerTradePercent,
          unit: '%',
        },
      };
    }

    const riskPercent = (maxLoss / account.netLiquidation) * 100;
    const limit = config.maxRiskPerTradePercent;
    const passed = riskPercent <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Spread max loss ${riskPercent.toFixed(2)}% is within ${limit}% limit`
        : `Spread max loss ${riskPercent.toFixed(2)}% exceeds ${limit}% limit`,
      details: {
        actual: riskPercent,
        limit,
        unit: '%',
      },
    };
  }

  /**
   * Check concentration for a spread.
   */
  private checkSpreadConcentration(
    underlying: string,
    maxLoss: number,
    context: ValidationContext
  ): RiskCheckResult {
    const checkType: RiskCheckType = 'concentration';
    const { config, account, positions } = context;

    if (account.netLiquidation <= 0) {
      return {
        checkType,
        passed: false,
        message: 'Cannot validate concentration: account value is zero or negative',
      };
    }

    const currentExposure = this.calculateUnderlyingExposure(underlying, positions);
    const totalExposure = currentExposure + (maxLoss === Infinity ? 0 : maxLoss);
    const concentrationPercent = (totalExposure / account.netLiquidation) * 100;
    const limit = config.maxRiskPerUnderlyingPercent;
    const passed = concentrationPercent <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Concentration in ${underlying} (${concentrationPercent.toFixed(2)}%) is within ${limit}% limit`
        : `Concentration in ${underlying} (${concentrationPercent.toFixed(2)}%) exceeds ${limit}% limit`,
      details: {
        actual: concentrationPercent,
        limit,
        unit: '%',
      },
    };
  }

  /**
   * Check buying power for a spread.
   */
  private checkSpreadBuyingPower(
    riskMetrics: SpreadRiskMetrics,
    context: ValidationContext
  ): RiskCheckResult {
    const checkType: RiskCheckType = 'buying_power';
    const { account } = context;

    // For debit spreads, cost is the net premium paid
    // For credit spreads, use max loss as margin requirement
    const requiredBuyingPower = riskMetrics.netPremium > 0
      ? riskMetrics.netPremium  // Debit spread: need to pay premium
      : riskMetrics.maxLoss === Infinity
        ? Math.abs(riskMetrics.netPremium) * 2  // Undefined risk: conservative estimate
        : riskMetrics.maxLoss;  // Credit spread: margin = max loss

    const passed = requiredBuyingPower <= account.buyingPower;

    return {
      checkType,
      passed,
      message: passed
        ? `Required $${requiredBuyingPower.toFixed(2)} is within buying power $${account.buyingPower.toFixed(2)}`
        : `Insufficient buying power: requires $${requiredBuyingPower.toFixed(2)}, available $${account.buyingPower.toFixed(2)}`,
      details: {
        actual: requiredBuyingPower,
        limit: account.buyingPower,
        unit: '$',
      },
    };
  }

  /**
   * Check max positions for a spread.
   */
  private checkMaxPositionsForSpread(
    proposal: TradeProposal,
    context: ValidationContext
  ): RiskCheckResult {
    const { config, positions } = context;
    const checkType: RiskCheckType = 'max_positions';

    const currentPositions = positions.filter((p) => p.quantity !== 0).length;

    // Check if this is adding to existing underlying
    const isNewPosition = !positions.some((p) => {
      const posUnderlying =
        p.assetClass === 'option' && p.optionDetails ? p.optionDetails.underlying : p.symbol;
      return posUnderlying === proposal.underlying;
    });

    const projectedPositions = isNewPosition ? currentPositions + 1 : currentPositions;
    const limit = config.maxOpenPositions;
    const passed = projectedPositions <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Position count ${projectedPositions} is within ${limit} position limit`
        : `Max positions exceeded: ${projectedPositions} positions would exceed ${limit} limit`,
      details: {
        actual: projectedPositions,
        limit,
        unit: 'positions',
      },
    };
  }

  /**
   * Check max contracts for a spread.
   */
  private checkMaxContractsForSpread(
    proposal: TradeProposal,
    context: ValidationContext
  ): RiskCheckResult {
    const { config } = context;
    const checkType: RiskCheckType = 'max_contracts';

    // For spreads, check the maximum contracts across all legs
    const maxQuantity = Math.max(...proposal.contracts.map(c => c.quantity));
    const limit = config.maxContractsPerPosition;
    const passed = maxQuantity <= limit;

    return {
      checkType,
      passed,
      message: passed
        ? `Max contracts per leg (${maxQuantity}) is within ${limit} contract limit`
        : `Max contracts exceeded: ${maxQuantity} contracts would exceed ${limit} limit`,
      details: {
        actual: maxQuantity,
        limit,
        unit: 'contracts',
      },
    };
  }

  /**
   * Log spread validation attempt for audit trail.
   */
  private logSpreadValidation(result: SpreadValidationResult, context: ValidationContext): void {
    const logData = {
      timestamp: result.validatedAt.toISOString(),
      valid: result.valid,
      proposal: {
        strategyType: result.proposal.strategyType,
        underlying: result.proposal.underlying,
        legCount: result.proposal.contracts.length,
      },
      riskMetrics: result.riskMetrics ? {
        maxLoss: result.riskMetrics.maxLoss,
        maxProfit: result.riskMetrics.maxProfit,
        isDefinedRisk: result.riskMetrics.isDefinedRisk,
      } : undefined,
      accountId: 'audit',
      checksRun: result.checks.length,
      checksPassed: result.checks.filter((c) => c.passed).length,
      checksFailed: result.checks.filter((c) => !c.passed).length,
    };

    if (result.valid) {
      this.logger.info('Spread validation PASSED', logData);
    } else {
      this.logger.warn('Spread validation FAILED', {
        ...logData,
        rejectionReasons: result.rejectionReasons,
      });
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a RiskEngine instance with default configuration.
 */
export function createRiskEngine(config?: RiskEngineConfig): RiskEngine {
  return new RiskEngine(config);
}

// ============================================================================
// Standalone Validation Function
// ============================================================================

/**
 * Validate an order against risk configuration.
 *
 * This is a convenience function that creates a temporary RiskEngine instance.
 * For repeated validations, create a RiskEngine instance directly.
 *
 * @param order - The order to validate
 * @param config - Risk configuration
 * @param account - Account summary
 * @param positions - Current positions
 * @param quote - Optional quote for liquidity check
 * @returns Validation result
 */
export function validateOrder(
  order: OrderRequest,
  config: RiskConfig,
  account: AccountSummary,
  positions: Position[],
  quote?: Quote | OptionContract
): OrderValidationResult {
  const engine = new RiskEngine();
  return engine.validateOrder(order, {
    config,
    account,
    positions,
    quote,
  });
}

/**
 * Validate a multi-leg spread against risk configuration.
 *
 * This function provides spread-aware risk calculations including
 * proper max loss for vertical spreads, iron condors, etc.
 *
 * @param proposal - The trade proposal to validate
 * @param config - Risk configuration
 * @param account - Account summary
 * @param positions - Current positions
 * @param legQuotes - Optional quotes for each leg (keyed by option symbol)
 * @param capabilities - Optional broker capabilities for spread validation
 * @returns Spread validation result with risk metrics
 */
export function validateSpread(
  proposal: TradeProposal,
  config: RiskConfig,
  account: AccountSummary,
  positions: Position[],
  legQuotes?: Map<string, Quote | OptionContract>,
  capabilities?: BrokerOptionsCapabilities
): SpreadValidationResult {
  const engine = new RiskEngine();
  return engine.validateSpread(proposal, {
    config,
    account,
    positions,
    legQuotes,
    capabilities,
  });
}
