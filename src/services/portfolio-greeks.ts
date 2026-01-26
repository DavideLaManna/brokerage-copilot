/**
 * Portfolio Greeks Aggregation Service
 *
 * Aggregates option Greeks (delta, theta, vega, gamma) across all positions
 * to provide portfolio-level risk metrics for directional and time-decay exposure.
 */

import type { Position, Greeks } from '../types/broker.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Aggregated portfolio Greeks
 */
export interface PortfolioGreeks {
  /** Total portfolio delta (directional exposure in share equivalents) */
  delta: number;
  /** Total portfolio gamma (delta sensitivity per $1 move) */
  gamma: number;
  /** Total portfolio theta (daily time decay in dollars) */
  theta: number;
  /** Total portfolio vega (sensitivity to 1% IV change) */
  vega: number;
  /** Number of positions with Greeks data */
  positionsWithGreeks: number;
  /** Number of positions without Greeks data (shown as N/A) */
  positionsWithoutGreeks: number;
  /** Total number of option positions */
  totalOptionPositions: number;
  /** Timestamp of calculation */
  calculatedAt: Date;
}

/**
 * Greek value with metadata for display
 */
export interface GreekValue {
  /** The Greek value (may be null if unavailable) */
  value: number | null;
  /** Display string (formatted value or 'N/A') */
  display: string;
  /** Whether this value is available */
  available: boolean;
}

/**
 * Position-level Greeks breakdown
 */
export interface PositionGreeksBreakdown {
  /** Position ID */
  positionId: string;
  /** Symbol */
  symbol: string;
  /** Underlying symbol */
  underlying: string;
  /** Contract quantity (signed) */
  quantity: number;
  /** Contract multiplier */
  multiplier: number;
  /** Raw position Greeks (before quantity/multiplier adjustment) */
  rawGreeks: Greeks | null;
  /** Adjusted delta (delta * quantity * multiplier) */
  adjustedDelta: number | null;
  /** Adjusted gamma (gamma * quantity * multiplier) */
  adjustedGamma: number | null;
  /** Adjusted theta (theta * quantity * multiplier) */
  adjustedTheta: number | null;
  /** Adjusted vega (vega * quantity * multiplier) */
  adjustedVega: number | null;
  /** Whether Greeks are available for this position */
  hasGreeks: boolean;
}

/**
 * Detailed portfolio Greeks with position breakdown
 */
export interface DetailedPortfolioGreeks extends PortfolioGreeks {
  /** Breakdown by position */
  breakdown: PositionGreeksBreakdown[];
  /** Greeks grouped by underlying */
  byUnderlying: Map<string, PortfolioGreeks>;
}

// ============================================================================
// Portfolio Greeks Calculator
// ============================================================================

/**
 * Calculate aggregated portfolio Greeks from positions
 *
 * @param positions - Array of current positions
 * @returns Portfolio Greeks summary
 */
export function calculatePortfolioGreeks(positions: Position[]): PortfolioGreeks {
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  let positionsWithGreeks = 0;
  let positionsWithoutGreeks = 0;
  let totalOptionPositions = 0;

  for (const position of positions) {
    // Only process option positions
    if (position.assetClass !== 'option' || !position.optionDetails) {
      continue;
    }

    totalOptionPositions++;
    const greeks = position.optionDetails.greeks;
    const multiplier = position.optionDetails.multiplier;
    const quantity = position.quantity;

    if (!greeks || (greeks.delta === undefined && greeks.gamma === undefined &&
        greeks.theta === undefined && greeks.vega === undefined)) {
      positionsWithoutGreeks++;
      continue;
    }

    positionsWithGreeks++;

    // Aggregate Greeks: multiply by quantity and multiplier
    // Quantity is positive for long, negative for short
    if (greeks.delta !== undefined) {
      delta += greeks.delta * quantity * multiplier;
    }
    if (greeks.gamma !== undefined) {
      gamma += greeks.gamma * quantity * multiplier;
    }
    if (greeks.theta !== undefined) {
      theta += greeks.theta * quantity * multiplier;
    }
    if (greeks.vega !== undefined) {
      vega += greeks.vega * quantity * multiplier;
    }
  }

  return {
    delta: roundGreek(delta),
    gamma: roundGreek(gamma),
    theta: roundGreek(theta),
    vega: roundGreek(vega),
    positionsWithGreeks,
    positionsWithoutGreeks,
    totalOptionPositions,
    calculatedAt: new Date(),
  };
}

/**
 * Calculate detailed portfolio Greeks with position breakdown
 *
 * @param positions - Array of current positions
 * @returns Detailed portfolio Greeks with breakdown
 */
export function calculateDetailedPortfolioGreeks(positions: Position[]): DetailedPortfolioGreeks {
  const breakdown: PositionGreeksBreakdown[] = [];
  const byUnderlying = new Map<string, {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    positionsWithGreeks: number;
    positionsWithoutGreeks: number;
    totalOptionPositions: number;
  }>();

  let totalDelta = 0;
  let totalGamma = 0;
  let totalTheta = 0;
  let totalVega = 0;
  let positionsWithGreeks = 0;
  let positionsWithoutGreeks = 0;
  let totalOptionPositions = 0;

  for (const position of positions) {
    // Only process option positions
    if (position.assetClass !== 'option' || !position.optionDetails) {
      continue;
    }

    totalOptionPositions++;
    const greeks = position.optionDetails.greeks ?? null;
    const multiplier = position.optionDetails.multiplier;
    const quantity = position.quantity;
    const underlying = position.optionDetails.underlying;

    // Initialize underlying bucket if needed
    if (!byUnderlying.has(underlying)) {
      byUnderlying.set(underlying, {
        delta: 0,
        gamma: 0,
        theta: 0,
        vega: 0,
        positionsWithGreeks: 0,
        positionsWithoutGreeks: 0,
        totalOptionPositions: 0,
      });
    }
    const underlyingBucket = byUnderlying.get(underlying)!;
    underlyingBucket.totalOptionPositions++;

    const hasGreeks = greeks !== null && (
      greeks.delta !== undefined ||
      greeks.gamma !== undefined ||
      greeks.theta !== undefined ||
      greeks.vega !== undefined
    );

    // Calculate adjusted Greeks
    let adjustedDelta: number | null = null;
    let adjustedGamma: number | null = null;
    let adjustedTheta: number | null = null;
    let adjustedVega: number | null = null;

    if (hasGreeks && greeks) {
      positionsWithGreeks++;
      underlyingBucket.positionsWithGreeks++;

      if (greeks.delta !== undefined) {
        adjustedDelta = greeks.delta * quantity * multiplier;
        totalDelta += adjustedDelta;
        underlyingBucket.delta += adjustedDelta;
      }
      if (greeks.gamma !== undefined) {
        adjustedGamma = greeks.gamma * quantity * multiplier;
        totalGamma += adjustedGamma;
        underlyingBucket.gamma += adjustedGamma;
      }
      if (greeks.theta !== undefined) {
        adjustedTheta = greeks.theta * quantity * multiplier;
        totalTheta += adjustedTheta;
        underlyingBucket.theta += adjustedTheta;
      }
      if (greeks.vega !== undefined) {
        adjustedVega = greeks.vega * quantity * multiplier;
        totalVega += adjustedVega;
        underlyingBucket.vega += adjustedVega;
      }
    } else {
      positionsWithoutGreeks++;
      underlyingBucket.positionsWithoutGreeks++;
    }

    breakdown.push({
      positionId: position.id,
      symbol: position.symbol,
      underlying,
      quantity,
      multiplier,
      rawGreeks: greeks,
      adjustedDelta,
      adjustedGamma,
      adjustedTheta,
      adjustedVega,
      hasGreeks,
    });
  }

  // Convert underlying buckets to PortfolioGreeks
  const byUnderlyingGreeks = new Map<string, PortfolioGreeks>();
  for (const [underlying, bucket] of byUnderlying) {
    byUnderlyingGreeks.set(underlying, {
      delta: roundGreek(bucket.delta),
      gamma: roundGreek(bucket.gamma),
      theta: roundGreek(bucket.theta),
      vega: roundGreek(bucket.vega),
      positionsWithGreeks: bucket.positionsWithGreeks,
      positionsWithoutGreeks: bucket.positionsWithoutGreeks,
      totalOptionPositions: bucket.totalOptionPositions,
      calculatedAt: new Date(),
    });
  }

  return {
    delta: roundGreek(totalDelta),
    gamma: roundGreek(totalGamma),
    theta: roundGreek(totalTheta),
    vega: roundGreek(totalVega),
    positionsWithGreeks,
    positionsWithoutGreeks,
    totalOptionPositions,
    calculatedAt: new Date(),
    breakdown,
    byUnderlying: byUnderlyingGreeks,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Round Greek value to reasonable precision
 */
function roundGreek(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Format a Greek value for display
 *
 * @param value - The Greek value (may be undefined/null)
 * @param decimals - Number of decimal places (default 2)
 * @returns Formatted Greek value
 */
export function formatGreekValue(
  value: number | undefined | null,
  decimals: number = 2
): GreekValue {
  if (value === undefined || value === null) {
    return {
      value: null,
      display: 'N/A',
      available: false,
    };
  }

  return {
    value,
    display: value.toFixed(decimals),
    available: true,
  };
}

/**
 * Format portfolio Greeks for display
 *
 * @param greeks - Portfolio Greeks
 * @returns Display-ready object
 */
export function formatPortfolioGreeksForDisplay(greeks: PortfolioGreeks): Record<string, string> {
  const formatWithSign = (val: number): string => {
    const prefix = val >= 0 ? '+' : '';
    return `${prefix}${val.toFixed(2)}`;
  };

  return {
    'Delta': formatWithSign(greeks.delta),
    'Gamma': formatWithSign(greeks.gamma),
    'Theta': formatWithSign(greeks.theta),
    'Vega': formatWithSign(greeks.vega),
    'Positions with Greeks': greeks.positionsWithGreeks.toString(),
    'Positions without Greeks': greeks.positionsWithoutGreeks.toString(),
    'Total Option Positions': greeks.totalOptionPositions.toString(),
  };
}

/**
 * Get Greek interpretation hints for the UI
 *
 * @param greeks - Portfolio Greeks
 * @returns Array of interpretation hints
 */
export function getGreeksInterpretation(greeks: PortfolioGreeks): string[] {
  const hints: string[] = [];

  // Delta interpretation
  if (Math.abs(greeks.delta) > 100) {
    if (greeks.delta > 0) {
      hints.push(`Portfolio has ${greeks.delta.toFixed(0)} delta-equivalent long shares exposure`);
    } else {
      hints.push(`Portfolio has ${Math.abs(greeks.delta).toFixed(0)} delta-equivalent short shares exposure`);
    }
  } else if (Math.abs(greeks.delta) < 10) {
    hints.push('Portfolio is approximately delta-neutral');
  }

  // Theta interpretation
  if (greeks.theta < -50) {
    hints.push(`Portfolio loses approximately $${Math.abs(greeks.theta).toFixed(0)}/day from time decay`);
  } else if (greeks.theta > 50) {
    hints.push(`Portfolio gains approximately $${greeks.theta.toFixed(0)}/day from time decay`);
  }

  // Vega interpretation
  if (Math.abs(greeks.vega) > 100) {
    if (greeks.vega > 0) {
      hints.push(`Portfolio gains $${greeks.vega.toFixed(0)} per 1% increase in IV`);
    } else {
      hints.push(`Portfolio loses $${Math.abs(greeks.vega).toFixed(0)} per 1% increase in IV`);
    }
  }

  // Gamma interpretation
  if (Math.abs(greeks.gamma) > 50) {
    if (greeks.gamma > 0) {
      hints.push('Portfolio has positive gamma (benefits from large moves)');
    } else {
      hints.push('Portfolio has negative gamma (harmed by large moves)');
    }
  }

  // Missing Greeks warning
  if (greeks.positionsWithoutGreeks > 0) {
    const pct = ((greeks.positionsWithoutGreeks / greeks.totalOptionPositions) * 100).toFixed(0);
    hints.push(`${pct}% of positions missing Greeks data (${greeks.positionsWithoutGreeks} of ${greeks.totalOptionPositions})`);
  }

  return hints;
}

/**
 * Check if portfolio Greeks indicate high risk
 *
 * @param greeks - Portfolio Greeks
 * @param thresholds - Risk thresholds
 * @returns Risk flags
 */
export function checkGreeksRisk(
  greeks: PortfolioGreeks,
  thresholds: {
    maxAbsDelta?: number;
    maxAbsGamma?: number;
    maxNegativeTheta?: number;
    maxAbsVega?: number;
  } = {}
): {
  highDeltaRisk: boolean;
  highGammaRisk: boolean;
  highThetaRisk: boolean;
  highVegaRisk: boolean;
  hasRisk: boolean;
} {
  const {
    maxAbsDelta = 1000,
    maxAbsGamma = 500,
    maxNegativeTheta = -200,
    maxAbsVega = 500,
  } = thresholds;

  const highDeltaRisk = Math.abs(greeks.delta) > maxAbsDelta;
  const highGammaRisk = Math.abs(greeks.gamma) > maxAbsGamma;
  const highThetaRisk = greeks.theta < maxNegativeTheta;
  const highVegaRisk = Math.abs(greeks.vega) > maxAbsVega;

  return {
    highDeltaRisk,
    highGammaRisk,
    highThetaRisk,
    highVegaRisk,
    hasRisk: highDeltaRisk || highGammaRisk || highThetaRisk || highVegaRisk,
  };
}
