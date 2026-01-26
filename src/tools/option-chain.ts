/**
 * Option Chain Tool
 *
 * MCP tool that retrieves option chain data for LLM analysis.
 * Returns strikes, expirations, bid/ask, Greeks, volume, OI, and liquidity scores.
 */

import { z } from 'zod';
import type { BrokerAdapter, OptionChain, OptionContract } from '../types/broker.js';
import {
  addLiquidityToChain,
  type OptionChainWithLiquidity,
  type OptionContractWithLiquidity,
  type LiquidityMetrics,
  type LiquidityScoringConfig,
  DEFAULT_LIQUIDITY_CONFIG,
} from '../services/liquidity.js';
import type { MCPToolDefinition, MCPToolResult } from './types.js';

// ============================================================================
// Option Chain Snapshot Types
// ============================================================================

/**
 * Option contract data for LLM snapshot
 */
export interface SnapshotOptionContract {
  /** OCC option symbol */
  optionSymbol: string;
  /** Underlying symbol */
  underlying: string;
  /** Strike price */
  strike: number;
  /** Expiration date (ISO string) */
  expiration: string;
  /** Days to expiration */
  daysToExpiration: number;
  /** Call or put */
  optionType: 'call' | 'put';
  /** Bid price */
  bid: number;
  /** Ask price */
  ask: number;
  /** Mid price */
  mid: number;
  /** Last traded price */
  last: number;
  /** Trading volume */
  volume: number;
  /** Open interest */
  openInterest: number;
  /** Contract multiplier (usually 100) */
  multiplier: number;
  /** Greeks (if available) */
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    rho?: number;
    impliedVolatility?: number;
  };
  /** Liquidity metrics */
  liquidity: {
    /** Bid-ask spread in absolute terms */
    spread: number;
    /** Bid-ask spread as percentage of mid */
    spreadPercent: number;
    /** Liquidity rating */
    rating: 'high' | 'medium' | 'low' | 'very_low';
    /** Low liquidity warning flag */
    lowLiquidityWarning: boolean;
    /** Human-readable description */
    description: string;
  };
}

/**
 * Expiration group for organized chain display
 */
export interface SnapshotExpiration {
  /** Expiration date (ISO string) */
  expiration: string;
  /** Days to expiration */
  daysToExpiration: number;
  /** Call contracts at this expiration */
  calls: SnapshotOptionContract[];
  /** Put contracts at this expiration */
  puts: SnapshotOptionContract[];
  /** Summary stats for this expiration */
  summary: {
    totalContracts: number;
    callCount: number;
    putCount: number;
    highLiquidityCount: number;
    lowLiquidityWarningCount: number;
    averageSpreadPercent: number;
  };
}

/**
 * Complete option chain snapshot returned by get_option_chain tool
 */
export interface OptionChainSnapshot {
  /** Underlying symbol */
  underlying: string;
  /** Current underlying price */
  underlyingPrice: number;
  /** Expirations with contracts grouped */
  expirations: SnapshotExpiration[];
  /** Overall chain summary */
  summary: {
    totalExpirations: number;
    totalContracts: number;
    callCount: number;
    putCount: number;
    highLiquidityCount: number;
    mediumLiquidityCount: number;
    lowLiquidityCount: number;
    veryLowLiquidityCount: number;
    lowLiquidityWarningCount: number;
    averageSpreadPercent: number;
    minDTE: number;
    maxDTE: number;
  };
  /** Request parameters used */
  request: {
    symbol: string;
    minDTE?: number;
    maxDTE?: number;
    minStrike?: number;
    maxStrike?: number;
  };
  /** Data timestamp */
  dataTimestamp: string;
  /** Data source information */
  dataSources: {
    source: string;
    retrievedAt: string;
  }[];
}

// ============================================================================
// Zod Schema for Input Validation
// ============================================================================

/**
 * Schema for get_option_chain input parameters
 */
export const GetOptionChainInputSchema = z.object({
  /** Underlying symbol to fetch option chain for (required) */
  symbol: z.string().min(1, 'Symbol is required'),
  /** Minimum days to expiration (optional, default 0) */
  minDTE: z.number().int().nonnegative().optional(),
  /** Maximum days to expiration (optional, default no limit) */
  maxDTE: z.number().int().positive().optional(),
  /** Minimum strike price (optional) */
  minStrike: z.number().positive().optional(),
  /** Maximum strike price (optional) */
  maxStrike: z.number().positive().optional(),
});

export type GetOptionChainInput = z.infer<typeof GetOptionChainInputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate days to expiration from a date
 */
function calculateDTE(expiration: Date): number {
  const now = new Date();
  const expDate = new Date(expiration);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((expDate.getTime() - now.getTime()) / msPerDay));
}

/**
 * Convert an OptionContractWithLiquidity to SnapshotOptionContract format
 */
function toSnapshotContract(contract: OptionContractWithLiquidity): SnapshotOptionContract {
  const result: SnapshotOptionContract = {
    optionSymbol: contract.optionSymbol,
    underlying: contract.underlying,
    strike: contract.strike,
    expiration: contract.expiration.toISOString(),
    daysToExpiration: calculateDTE(contract.expiration),
    optionType: contract.optionType,
    bid: contract.bid,
    ask: contract.ask,
    mid: contract.mid,
    last: contract.last,
    volume: contract.volume,
    openInterest: contract.openInterest,
    multiplier: contract.multiplier,
    liquidity: {
      spread: contract.liquidity.spread,
      spreadPercent: contract.liquidity.spreadPercent,
      rating: contract.liquidity.rating,
      lowLiquidityWarning: contract.liquidity.lowLiquidityWarning,
      description: contract.liquidity.description,
    },
  };

  if (contract.greeks) {
    result.greeks = {
      delta: contract.greeks.delta,
      gamma: contract.greeks.gamma,
      theta: contract.greeks.theta,
      vega: contract.greeks.vega,
      rho: contract.greeks.rho,
      impliedVolatility: contract.greeks.impliedVolatility,
    };
  }

  return result;
}

/**
 * Build expiration summary statistics
 */
function buildExpirationSummary(
  calls: SnapshotOptionContract[],
  puts: SnapshotOptionContract[]
): SnapshotExpiration['summary'] {
  const allContracts = [...calls, ...puts];
  let highLiquidityCount = 0;
  let lowLiquidityWarningCount = 0;
  let totalSpreadPercent = 0;
  let validSpreadCount = 0;

  for (const contract of allContracts) {
    if (contract.liquidity.rating === 'high') {
      highLiquidityCount++;
    }
    if (contract.liquidity.lowLiquidityWarning) {
      lowLiquidityWarningCount++;
    }
    if (isFinite(contract.liquidity.spreadPercent)) {
      totalSpreadPercent += contract.liquidity.spreadPercent;
      validSpreadCount++;
    }
  }

  return {
    totalContracts: allContracts.length,
    callCount: calls.length,
    putCount: puts.length,
    highLiquidityCount,
    lowLiquidityWarningCount,
    averageSpreadPercent: validSpreadCount > 0 ? totalSpreadPercent / validSpreadCount : 0,
  };
}

/**
 * Build overall chain summary statistics
 */
function buildChainSummary(expirations: SnapshotExpiration[]): OptionChainSnapshot['summary'] {
  let totalContracts = 0;
  let callCount = 0;
  let putCount = 0;
  let highLiquidityCount = 0;
  let mediumLiquidityCount = 0;
  let lowLiquidityCount = 0;
  let veryLowLiquidityCount = 0;
  let lowLiquidityWarningCount = 0;
  let totalSpreadPercent = 0;
  let validSpreadCount = 0;
  let minDTE = Infinity;
  let maxDTE = -Infinity;

  for (const exp of expirations) {
    const allContracts = [...exp.calls, ...exp.puts];
    totalContracts += allContracts.length;
    callCount += exp.calls.length;
    putCount += exp.puts.length;

    for (const contract of allContracts) {
      switch (contract.liquidity.rating) {
        case 'high':
          highLiquidityCount++;
          break;
        case 'medium':
          mediumLiquidityCount++;
          break;
        case 'low':
          lowLiquidityCount++;
          break;
        case 'very_low':
          veryLowLiquidityCount++;
          break;
      }

      if (contract.liquidity.lowLiquidityWarning) {
        lowLiquidityWarningCount++;
      }

      if (isFinite(contract.liquidity.spreadPercent)) {
        totalSpreadPercent += contract.liquidity.spreadPercent;
        validSpreadCount++;
      }

      minDTE = Math.min(minDTE, contract.daysToExpiration);
      maxDTE = Math.max(maxDTE, contract.daysToExpiration);
    }
  }

  return {
    totalExpirations: expirations.length,
    totalContracts,
    callCount,
    putCount,
    highLiquidityCount,
    mediumLiquidityCount,
    lowLiquidityCount,
    veryLowLiquidityCount,
    lowLiquidityWarningCount,
    averageSpreadPercent: validSpreadCount > 0 ? totalSpreadPercent / validSpreadCount : 0,
    minDTE: isFinite(minDTE) ? minDTE : 0,
    maxDTE: isFinite(maxDTE) ? maxDTE : 0,
  };
}

// ============================================================================
// Option Chain Snapshot Builder
// ============================================================================

/**
 * Build a complete option chain snapshot with liquidity scoring
 */
export async function buildOptionChainSnapshot(
  adapter: BrokerAdapter,
  input: GetOptionChainInput,
  liquidityConfig: LiquidityScoringConfig = DEFAULT_LIQUIDITY_CONFIG
): Promise<OptionChainSnapshot> {
  const startTime = new Date();

  // Fetch option chain from broker
  const chain = await adapter.getOptionChain({
    symbol: input.symbol,
    minDTE: input.minDTE,
    maxDTE: input.maxDTE,
    minStrike: input.minStrike,
    maxStrike: input.maxStrike,
  });

  // Add liquidity metrics to all contracts
  const chainWithLiquidity = addLiquidityToChain(chain, liquidityConfig);

  // Build expiration groups
  const expirations: SnapshotExpiration[] = [];

  for (const [expirationStr, contracts] of chainWithLiquidity.contracts) {
    // Convert and split by option type
    const snapshotContracts = contracts.map(toSnapshotContract);
    const calls = snapshotContracts
      .filter((c) => c.optionType === 'call')
      .sort((a, b) => a.strike - b.strike);
    const puts = snapshotContracts
      .filter((c) => c.optionType === 'put')
      .sort((a, b) => a.strike - b.strike);

    const firstContract = snapshotContracts[0];
    const dte = firstContract !== undefined ? firstContract.daysToExpiration : 0;

    expirations.push({
      expiration: expirationStr,
      daysToExpiration: dte,
      calls,
      puts,
      summary: buildExpirationSummary(calls, puts),
    });
  }

  // Sort expirations by DTE (nearest first)
  expirations.sort((a, b) => a.daysToExpiration - b.daysToExpiration);

  // Build overall summary
  const summary = buildChainSummary(expirations);

  return {
    underlying: chain.underlying,
    underlyingPrice: chain.underlyingPrice,
    expirations,
    summary,
    request: {
      symbol: input.symbol,
      minDTE: input.minDTE,
      maxDTE: input.maxDTE,
      minStrike: input.minStrike,
      maxStrike: input.maxStrike,
    },
    dataTimestamp: startTime.toISOString(),
    dataSources: [
      {
        source: `${adapter.brokerName} (${adapter.brokerType})`,
        retrievedAt: startTime.toISOString(),
      },
    ],
  };
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

/**
 * Context required for option chain tool
 */
export interface OptionChainToolContext {
  /** Broker adapter for fetching data */
  adapter: BrokerAdapter | null;
  /** Optional custom liquidity config */
  liquidityConfig?: LiquidityScoringConfig;
}

/**
 * Create the get_option_chain tool definition
 *
 * @param context - Tool context with dependencies
 * @returns MCP tool definition
 */
export function createOptionChainTool(context: OptionChainToolContext): MCPToolDefinition {
  return {
    name: 'get_option_chain',
    description: `Retrieve option chain data for a symbol with liquidity analysis.

Returns for each contract:
- Strike price, expiration, and option type (call/put)
- Bid/ask prices with spread percentage
- Volume and open interest
- Greeks (delta, gamma, theta, vega, IV) when available
- Liquidity score and warnings

Filter options:
- symbol (required): Underlying ticker (e.g., "AAPL", "SPY")
- minDTE: Minimum days to expiration (default: 0)
- maxDTE: Maximum days to expiration (optional)
- minStrike: Minimum strike price (optional)
- maxStrike: Maximum strike price (optional)

Use this tool to analyze available options before recommending trades.`,
    inputSchema: GetOptionChainInputSchema,
    handler: async (input: unknown): Promise<MCPToolResult> => {
      const startTime = new Date();

      // Check if connected to broker
      if (!context.adapter) {
        return {
          success: false,
          error: 'Not connected to broker. Please establish a connection first.',
          timestamp: startTime.toISOString(),
        };
      }

      try {
        // Parse and validate input
        const parsedInput = GetOptionChainInputSchema.parse(input);

        // Build the snapshot
        const snapshot = await buildOptionChainSnapshot(
          context.adapter,
          parsedInput,
          context.liquidityConfig
        );

        return {
          success: true,
          data: snapshot,
          timestamp: startTime.toISOString(),
          metadata: {
            underlying: snapshot.underlying,
            underlyingPrice: snapshot.underlyingPrice,
            expirationCount: snapshot.summary.totalExpirations,
            contractCount: snapshot.summary.totalContracts,
            callCount: snapshot.summary.callCount,
            putCount: snapshot.summary.putCount,
            highLiquidityCount: snapshot.summary.highLiquidityCount,
            lowLiquidityWarningCount: snapshot.summary.lowLiquidityWarningCount,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          success: false,
          error: `Failed to retrieve option chain: ${errorMessage}`,
          timestamp: startTime.toISOString(),
        };
      }
    },
  };
}

/**
 * Standalone function to get option chain snapshot (for direct API use)
 *
 * @param adapter - Broker adapter
 * @param input - Request parameters
 * @param liquidityConfig - Optional custom liquidity config
 * @returns Option chain snapshot
 */
export async function getOptionChain(
  adapter: BrokerAdapter,
  input: GetOptionChainInput,
  liquidityConfig?: LiquidityScoringConfig
): Promise<OptionChainSnapshot> {
  return buildOptionChainSnapshot(adapter, input, liquidityConfig);
}
