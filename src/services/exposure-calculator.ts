/**
 * Portfolio Exposure Calculator
 *
 * Aggregates positions by underlying symbol and calculates:
 * - Total notional exposure per underlying
 * - Risk (max loss) per underlying
 * - Concentration percentage of account
 * - Warnings for underlyings exceeding concentration limits
 */

import type { Position, AccountSummary, Greeks } from '../types/broker.js';
import type { RiskConfig } from '../types/risk-config.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Exposure metrics for a single underlying
 */
export interface UnderlyingExposure {
  /** The underlying symbol (e.g., 'AAPL') */
  symbol: string;
  /** Total notional exposure in dollars */
  notionalExposure: number;
  /** Total risk (max potential loss) in dollars */
  risk: number;
  /** Exposure as percentage of account value */
  exposurePercent: number;
  /** Risk as percentage of account value */
  riskPercent: number;
  /** Number of positions in this underlying */
  positionCount: number;
  /** Total quantity across all positions (positive = net long, negative = net short) */
  netQuantity: number;
  /** Total market value of positions */
  marketValue: number;
  /** Total unrealized P&L */
  unrealizedPnL: number;
  /** Whether this underlying exceeds the concentration limit */
  exceedsLimit: boolean;
  /** Warning message if exceeds limit */
  warning?: string;
  /** Aggregated Greeks for all option positions */
  aggregatedGreeks?: AggregatedGreeks;
  /** Breakdown of positions in this underlying */
  positions: PositionSummary[];
}

/**
 * Summary of a single position for exposure breakdown
 */
export interface PositionSummary {
  /** Position ID */
  id: string;
  /** Symbol (option symbol or equity symbol) */
  symbol: string;
  /** Asset class */
  assetClass: 'equity' | 'option';
  /** Quantity (positive = long, negative = short) */
  quantity: number;
  /** Market value */
  marketValue: number;
  /** Notional exposure from this position */
  notionalExposure: number;
  /** Risk from this position */
  risk: number;
  /** Option details if applicable */
  optionType?: 'call' | 'put';
  /** Strike price for options */
  strike?: number;
  /** Days to expiration for options */
  dte?: number;
}

/**
 * Aggregated Greeks across positions
 */
export interface AggregatedGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/**
 * Complete portfolio exposure summary
 */
export interface PortfolioExposure {
  /** Exposure data for each underlying */
  underlyings: UnderlyingExposure[];
  /** Total portfolio notional exposure */
  totalNotionalExposure: number;
  /** Total portfolio risk (max loss) */
  totalRisk: number;
  /** Total portfolio risk as percentage of account */
  totalRiskPercent: number;
  /** Number of underlyings with positions */
  underlyingCount: number;
  /** Number of underlyings exceeding concentration limit */
  exceedingLimitCount: number;
  /** Timestamp of calculation */
  calculatedAt: Date;
}

/**
 * Configuration for exposure calculation
 */
export interface ExposureCalculatorConfig {
  /** Concentration limit as percentage (for warning threshold) */
  concentrationLimitPercent?: number;
}

// ============================================================================
// Exposure Calculator Class
// ============================================================================

/**
 * Portfolio Exposure Calculator
 *
 * Aggregates positions by underlying and computes exposure metrics.
 */
export class ExposureCalculator {
  private concentrationLimitPercent: number;

  constructor(config: ExposureCalculatorConfig = {}) {
    this.concentrationLimitPercent = config.concentrationLimitPercent ?? 10;
  }

  /**
   * Calculate exposure for a portfolio of positions
   *
   * @param positions - Array of current positions
   * @param account - Account summary (for percentage calculations)
   * @param riskConfig - Optional risk configuration (for concentration limit)
   * @returns Portfolio exposure summary
   */
  calculateExposure(
    positions: Position[],
    account: AccountSummary,
    riskConfig?: RiskConfig
  ): PortfolioExposure {
    const concentrationLimit = riskConfig?.maxRiskPerUnderlyingPercent ?? this.concentrationLimitPercent;
    const accountValue = account.netLiquidation;

    // Group positions by underlying symbol
    const positionsByUnderlying = this.groupByUnderlying(positions);

    // Calculate exposure for each underlying
    const underlyings: UnderlyingExposure[] = [];
    let totalNotionalExposure = 0;
    let totalRisk = 0;
    let exceedingLimitCount = 0;

    for (const [symbol, underlyingPositions] of positionsByUnderlying) {
      const exposure = this.calculateUnderlyingExposure(
        symbol,
        underlyingPositions,
        accountValue,
        concentrationLimit
      );

      underlyings.push(exposure);
      totalNotionalExposure += exposure.notionalExposure;
      totalRisk += exposure.risk;

      if (exposure.exceedsLimit) {
        exceedingLimitCount++;
      }
    }

    // Sort by exposure (descending)
    underlyings.sort((a, b) => b.exposurePercent - a.exposurePercent);

    const totalRiskPercent = accountValue > 0 ? (totalRisk / accountValue) * 100 : 0;

    return {
      underlyings,
      totalNotionalExposure,
      totalRisk,
      totalRiskPercent,
      underlyingCount: underlyings.length,
      exceedingLimitCount,
      calculatedAt: new Date(),
    };
  }

  /**
   * Group positions by underlying symbol
   */
  private groupByUnderlying(positions: Position[]): Map<string, Position[]> {
    const groups = new Map<string, Position[]>();

    for (const position of positions) {
      // Get underlying symbol: for options use optionDetails.underlying, for equity use symbol
      const underlying =
        position.assetClass === 'option' && position.optionDetails
          ? position.optionDetails.underlying
          : position.symbol;

      if (!groups.has(underlying)) {
        groups.set(underlying, []);
      }
      groups.get(underlying)!.push(position);
    }

    return groups;
  }

  /**
   * Calculate exposure metrics for a single underlying
   */
  private calculateUnderlyingExposure(
    symbol: string,
    positions: Position[],
    accountValue: number,
    concentrationLimit: number
  ): UnderlyingExposure {
    let notionalExposure = 0;
    let risk = 0;
    let netQuantity = 0;
    let marketValue = 0;
    let unrealizedPnL = 0;
    const positionSummaries: PositionSummary[] = [];

    // Aggregate Greeks
    const aggregatedGreeks: AggregatedGreeks = {
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
    };
    let hasGreeks = false;

    for (const position of positions) {
      const posNotional = this.calculateNotionalExposure(position);
      const posRisk = this.calculatePositionRisk(position);

      notionalExposure += posNotional;
      risk += posRisk;
      marketValue += position.marketValue;
      unrealizedPnL += position.unrealizedPnL;

      // Calculate net quantity (for equity)
      if (position.assetClass === 'equity') {
        netQuantity += position.quantity;
      } else if (position.optionDetails) {
        // For options, convert to delta-equivalent shares
        const delta = position.optionDetails.greeks?.delta ?? 0;
        const multiplier = position.optionDetails.multiplier;
        netQuantity += position.quantity * delta * multiplier;
      }

      // Aggregate Greeks for options
      if (position.assetClass === 'option' && position.optionDetails?.greeks) {
        const greeks = position.optionDetails.greeks;
        const multiplier = position.optionDetails.multiplier;
        const qty = position.quantity;

        if (greeks.delta !== undefined) {
          aggregatedGreeks.delta += greeks.delta * qty * multiplier;
          hasGreeks = true;
        }
        if (greeks.gamma !== undefined) {
          aggregatedGreeks.gamma += greeks.gamma * qty * multiplier;
        }
        if (greeks.theta !== undefined) {
          aggregatedGreeks.theta += greeks.theta * qty * multiplier;
        }
        if (greeks.vega !== undefined) {
          aggregatedGreeks.vega += greeks.vega * qty * multiplier;
        }
      }

      // Build position summary
      const summary: PositionSummary = {
        id: position.id,
        symbol: position.symbol,
        assetClass: position.assetClass,
        quantity: position.quantity,
        marketValue: position.marketValue,
        notionalExposure: posNotional,
        risk: posRisk,
      };

      if (position.assetClass === 'option' && position.optionDetails) {
        summary.optionType = position.optionDetails.optionType;
        summary.strike = position.optionDetails.strike;
        summary.dte = this.calculateDTE(position.optionDetails.expiration);
      }

      positionSummaries.push(summary);
    }

    // Calculate percentages
    const exposurePercent = accountValue > 0 ? (notionalExposure / accountValue) * 100 : 0;
    const riskPercent = accountValue > 0 ? (risk / accountValue) * 100 : 0;

    // Check against concentration limit
    const exceedsLimit = riskPercent > concentrationLimit;
    let warning: string | undefined;
    if (exceedsLimit) {
      warning = `${symbol} exposure (${riskPercent.toFixed(1)}%) exceeds ${concentrationLimit}% concentration limit`;
    }

    return {
      symbol,
      notionalExposure,
      risk,
      exposurePercent,
      riskPercent,
      positionCount: positions.length,
      netQuantity: Math.round(netQuantity * 100) / 100, // Round to 2 decimals
      marketValue,
      unrealizedPnL,
      exceedsLimit,
      warning,
      aggregatedGreeks: hasGreeks ? aggregatedGreeks : undefined,
      positions: positionSummaries,
    };
  }

  /**
   * Calculate notional exposure for a position
   *
   * For equity: shares * price
   * For options: contracts * strike * multiplier (notional value of underlying)
   */
  private calculateNotionalExposure(position: Position): number {
    if (position.assetClass === 'equity') {
      return Math.abs(position.quantity * position.currentPrice);
    }

    if (position.optionDetails) {
      const strike = position.optionDetails.strike;
      const multiplier = position.optionDetails.multiplier;
      const contracts = Math.abs(position.quantity);
      return contracts * strike * multiplier;
    }

    // Fallback to market value
    return Math.abs(position.marketValue);
  }

  /**
   * Calculate risk (max potential loss) for a position
   *
   * For long equity: position value (can go to zero)
   * For short equity: unlimited (use 2x position value as proxy)
   * For long options: premium paid (market value)
   * For short options: strike * multiplier (max loss if assigned)
   */
  private calculatePositionRisk(position: Position): number {
    if (position.assetClass === 'equity') {
      if (position.quantity > 0) {
        // Long equity: can lose entire value
        return Math.abs(position.marketValue);
      } else {
        // Short equity: theoretically unlimited, use 2x as proxy
        return Math.abs(position.marketValue) * 2;
      }
    }

    if (position.optionDetails) {
      const multiplier = position.optionDetails.multiplier;
      const contracts = Math.abs(position.quantity);

      if (position.quantity > 0) {
        // Long options: max loss is premium paid
        return Math.abs(position.marketValue);
      } else {
        // Short options: max loss depends on type
        if (position.optionDetails.optionType === 'put') {
          // Short put: max loss = strike * multiplier * contracts
          return position.optionDetails.strike * multiplier * contracts;
        } else {
          // Short call: theoretically unlimited, use 3x strike as proxy
          return position.optionDetails.strike * multiplier * contracts * 3;
        }
      }
    }

    // Fallback
    return Math.abs(position.marketValue);
  }

  /**
   * Calculate days to expiration
   */
  private calculateDTE(expiration: Date): number {
    const now = new Date();
    const expDate = new Date(expiration);
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.max(0, Math.floor((expDate.getTime() - now.getTime()) / msPerDay));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an ExposureCalculator instance
 */
export function createExposureCalculator(config?: ExposureCalculatorConfig): ExposureCalculator {
  return new ExposureCalculator(config);
}

// ============================================================================
// Standalone Functions
// ============================================================================

/**
 * Calculate portfolio exposure (convenience function)
 *
 * @param positions - Array of current positions
 * @param account - Account summary
 * @param riskConfig - Optional risk configuration
 * @returns Portfolio exposure summary
 */
export function calculatePortfolioExposure(
  positions: Position[],
  account: AccountSummary,
  riskConfig?: RiskConfig
): PortfolioExposure {
  const calculator = new ExposureCalculator();
  return calculator.calculateExposure(positions, account, riskConfig);
}

/**
 * Get underlyings that exceed the concentration limit
 *
 * @param exposure - Portfolio exposure data
 * @returns Array of underlyings exceeding limit
 */
export function getExceedingLimitUnderlyings(exposure: PortfolioExposure): UnderlyingExposure[] {
  return exposure.underlyings.filter((u) => u.exceedsLimit);
}

/**
 * Format exposure data for display
 *
 * @param exposure - Underlying exposure data
 * @returns Formatted display object
 */
export function formatExposureForDisplay(exposure: UnderlyingExposure): Record<string, string> {
  return {
    'Symbol': exposure.symbol,
    'Notional': `$${exposure.notionalExposure.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    'Risk': `$${exposure.risk.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    'Exposure %': `${exposure.exposurePercent.toFixed(1)}%`,
    'Risk %': `${exposure.riskPercent.toFixed(1)}%`,
    'Positions': exposure.positionCount.toString(),
    'Net Qty': exposure.netQuantity.toFixed(0),
    'Market Value': `$${exposure.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    'P&L': `$${exposure.unrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  };
}
