/**
 * Liquidity Scoring Service
 *
 * Computes liquidity metrics for option contracts to help traders
 * identify contracts that may be difficult to enter or exit.
 */

import type { OptionContract, OptionChain, Quote } from '../types/broker.js';

// ============================================================================
// Liquidity Types
// ============================================================================

/**
 * Liquidity rating levels
 */
export type LiquidityRating = 'high' | 'medium' | 'low' | 'very_low';

/**
 * Liquidity metrics for a single option contract
 */
export interface LiquidityMetrics {
  /** Bid-ask spread in absolute terms (ask - bid) */
  spread: number;
  /** Bid-ask spread as percentage of mid price: (ask - bid) / mid * 100 */
  spreadPercent: number;
  /** Mid price used for calculation */
  midPrice: number;
  /** Trading volume */
  volume: number;
  /** Open interest */
  openInterest: number;
  /** Overall liquidity rating */
  rating: LiquidityRating;
  /** Whether this contract has low liquidity (spread > threshold) */
  lowLiquidityWarning: boolean;
  /** Human-readable liquidity description */
  description: string;
}

/**
 * Option contract with liquidity metrics attached
 */
export interface OptionContractWithLiquidity extends OptionContract {
  liquidity: LiquidityMetrics;
}

/**
 * Option chain with liquidity scores for all contracts
 */
export interface OptionChainWithLiquidity extends Omit<OptionChain, 'contracts'> {
  contracts: Map<string, OptionContractWithLiquidity[]>;
}

/**
 * Configuration for liquidity scoring
 */
export interface LiquidityScoringConfig {
  /** Threshold for low liquidity warning (default: 5%) */
  lowLiquidityThreshold: number;
  /** Threshold for medium liquidity (default: 2%) */
  mediumLiquidityThreshold: number;
  /** Threshold for high liquidity (default: 1%) */
  highLiquidityThreshold: number;
  /** Minimum volume for good liquidity consideration */
  minVolumeForGoodLiquidity: number;
  /** Minimum open interest for good liquidity consideration */
  minOpenInterestForGoodLiquidity: number;
}

/**
 * Default liquidity scoring configuration
 */
export const DEFAULT_LIQUIDITY_CONFIG: LiquidityScoringConfig = {
  lowLiquidityThreshold: 5, // 5%
  mediumLiquidityThreshold: 2, // 2%
  highLiquidityThreshold: 1, // 1%
  minVolumeForGoodLiquidity: 100,
  minOpenInterestForGoodLiquidity: 500,
};

// ============================================================================
// Liquidity Scoring Functions
// ============================================================================

/**
 * Calculate bid-ask spread percentage.
 * Formula: (ask - bid) / mid * 100
 *
 * @param bid - Bid price
 * @param ask - Ask price
 * @returns Spread percentage, or Infinity if prices are invalid
 */
export function calculateSpreadPercent(bid: number, ask: number): number {
  if (bid <= 0 || ask <= 0 || ask < bid) {
    return Infinity;
  }

  const mid = (bid + ask) / 2;
  if (mid <= 0) {
    return Infinity;
  }

  return ((ask - bid) / mid) * 100;
}

/**
 * Determine liquidity rating based on spread percentage and volume/OI.
 *
 * @param spreadPercent - Bid-ask spread percentage
 * @param volume - Trading volume
 * @param openInterest - Open interest
 * @param config - Liquidity scoring configuration
 * @returns Liquidity rating
 */
export function getLiquidityRating(
  spreadPercent: number,
  volume: number,
  openInterest: number,
  config: LiquidityScoringConfig = DEFAULT_LIQUIDITY_CONFIG
): LiquidityRating {
  // Very low liquidity: spread > low threshold or no quotes
  if (spreadPercent > config.lowLiquidityThreshold || !isFinite(spreadPercent)) {
    return 'very_low';
  }

  // Low liquidity: spread > medium threshold
  if (spreadPercent > config.mediumLiquidityThreshold) {
    return 'low';
  }

  // Medium liquidity: spread > high threshold or low volume/OI
  if (
    spreadPercent > config.highLiquidityThreshold ||
    volume < config.minVolumeForGoodLiquidity ||
    openInterest < config.minOpenInterestForGoodLiquidity
  ) {
    return 'medium';
  }

  // High liquidity: tight spread with good volume/OI
  return 'high';
}

/**
 * Generate a human-readable description of liquidity.
 *
 * @param metrics - Liquidity metrics
 * @returns Description string
 */
export function getLiquidityDescription(metrics: LiquidityMetrics): string {
  const { spreadPercent, volume, openInterest, rating } = metrics;

  if (!isFinite(spreadPercent)) {
    return 'No valid quotes available';
  }

  const spreadStr = spreadPercent.toFixed(2);
  const volumeStr = volume.toLocaleString();
  const oiStr = openInterest.toLocaleString();

  switch (rating) {
    case 'high':
      return `Excellent liquidity: ${spreadStr}% spread, Vol ${volumeStr}, OI ${oiStr}`;
    case 'medium':
      return `Good liquidity: ${spreadStr}% spread, Vol ${volumeStr}, OI ${oiStr}`;
    case 'low':
      return `Fair liquidity: ${spreadStr}% spread, Vol ${volumeStr}, OI ${oiStr}`;
    case 'very_low':
      return `Poor liquidity: ${spreadStr}% spread, Vol ${volumeStr}, OI ${oiStr}`;
  }
}

/**
 * Compute liquidity metrics for a single option contract.
 *
 * @param contract - Option contract with bid/ask/volume/OI
 * @param config - Liquidity scoring configuration
 * @returns Liquidity metrics
 */
export function computeLiquidityMetrics(
  contract: OptionContract | Quote,
  config: LiquidityScoringConfig = DEFAULT_LIQUIDITY_CONFIG
): LiquidityMetrics {
  const { bid, ask, volume } = contract;
  const openInterest = 'openInterest' in contract ? contract.openInterest : 0;

  const spread = ask - bid;
  const midPrice = (bid + ask) / 2;
  const spreadPercent = calculateSpreadPercent(bid, ask);
  const rating = getLiquidityRating(spreadPercent, volume, openInterest, config);
  const lowLiquidityWarning = spreadPercent > config.lowLiquidityThreshold;

  const metrics: LiquidityMetrics = {
    spread,
    spreadPercent,
    midPrice,
    volume,
    openInterest,
    rating,
    lowLiquidityWarning,
    description: '', // Will be filled in
  };

  metrics.description = getLiquidityDescription(metrics);

  return metrics;
}

/**
 * Add liquidity metrics to an option contract.
 *
 * @param contract - Option contract
 * @param config - Liquidity scoring configuration
 * @returns Option contract with liquidity metrics attached
 */
export function addLiquidityToContract(
  contract: OptionContract,
  config: LiquidityScoringConfig = DEFAULT_LIQUIDITY_CONFIG
): OptionContractWithLiquidity {
  const liquidity = computeLiquidityMetrics(contract, config);

  return {
    ...contract,
    liquidity,
  };
}

/**
 * Add liquidity metrics to all contracts in an option chain.
 *
 * @param chain - Option chain
 * @param config - Liquidity scoring configuration
 * @returns Option chain with liquidity metrics for all contracts
 */
export function addLiquidityToChain(
  chain: OptionChain,
  config: LiquidityScoringConfig = DEFAULT_LIQUIDITY_CONFIG
): OptionChainWithLiquidity {
  const contractsWithLiquidity = new Map<string, OptionContractWithLiquidity[]>();

  for (const [expiration, contracts] of chain.contracts) {
    const contractsWithMetrics = contracts.map((contract) =>
      addLiquidityToContract(contract, config)
    );
    contractsWithLiquidity.set(expiration, contractsWithMetrics);
  }

  return {
    underlying: chain.underlying,
    underlyingPrice: chain.underlyingPrice,
    expirations: chain.expirations,
    contracts: contractsWithLiquidity,
    asOf: chain.asOf,
  };
}

/**
 * Filter option contracts to only include those with sufficient liquidity.
 *
 * @param contracts - Array of option contracts with liquidity
 * @param minRating - Minimum liquidity rating to include (default: 'low')
 * @returns Filtered contracts
 */
export function filterByLiquidity(
  contracts: OptionContractWithLiquidity[],
  minRating: LiquidityRating = 'low'
): OptionContractWithLiquidity[] {
  const ratingOrder: Record<LiquidityRating, number> = {
    very_low: 0,
    low: 1,
    medium: 2,
    high: 3,
  };

  const minRatingValue = ratingOrder[minRating];

  return contracts.filter((contract) => ratingOrder[contract.liquidity.rating] >= minRatingValue);
}

/**
 * Sort option contracts by liquidity (best liquidity first).
 *
 * @param contracts - Array of option contracts with liquidity
 * @returns Sorted contracts
 */
export function sortByLiquidity(
  contracts: OptionContractWithLiquidity[]
): OptionContractWithLiquidity[] {
  return [...contracts].sort((a, b) => {
    // First sort by rating
    const ratingOrder: Record<LiquidityRating, number> = {
      high: 0,
      medium: 1,
      low: 2,
      very_low: 3,
    };

    const ratingDiff = ratingOrder[a.liquidity.rating] - ratingOrder[b.liquidity.rating];
    if (ratingDiff !== 0) return ratingDiff;

    // Then by spread percent
    return a.liquidity.spreadPercent - b.liquidity.spreadPercent;
  });
}

/**
 * Get a summary of liquidity across an option chain.
 *
 * @param chain - Option chain with liquidity
 * @returns Summary statistics
 */
export function getChainLiquiditySummary(chain: OptionChainWithLiquidity): {
  totalContracts: number;
  highLiquidity: number;
  mediumLiquidity: number;
  lowLiquidity: number;
  veryLowLiquidity: number;
  averageSpreadPercent: number;
  warningCount: number;
} {
  let totalContracts = 0;
  let highLiquidity = 0;
  let mediumLiquidity = 0;
  let lowLiquidity = 0;
  let veryLowLiquidity = 0;
  let totalSpreadPercent = 0;
  let validSpreadCount = 0;
  let warningCount = 0;

  for (const [, contracts] of chain.contracts) {
    for (const contract of contracts) {
      totalContracts++;

      switch (contract.liquidity.rating) {
        case 'high':
          highLiquidity++;
          break;
        case 'medium':
          mediumLiquidity++;
          break;
        case 'low':
          lowLiquidity++;
          break;
        case 'very_low':
          veryLowLiquidity++;
          break;
      }

      if (isFinite(contract.liquidity.spreadPercent)) {
        totalSpreadPercent += contract.liquidity.spreadPercent;
        validSpreadCount++;
      }

      if (contract.liquidity.lowLiquidityWarning) {
        warningCount++;
      }
    }
  }

  return {
    totalContracts,
    highLiquidity,
    mediumLiquidity,
    lowLiquidity,
    veryLowLiquidity,
    averageSpreadPercent: validSpreadCount > 0 ? totalSpreadPercent / validSpreadCount : 0,
    warningCount,
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  calculateSpreadPercent as computeSpreadPercent, // Alias for clarity
};
