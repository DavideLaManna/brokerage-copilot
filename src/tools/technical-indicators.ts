/**
 * Technical Indicators Tool
 *
 * MCP tool that computes technical indicators for LLM analysis.
 * Supports RSI, Moving Averages (SMA/EMA), and ATR with interpretation hints.
 */

import { z } from 'zod';
import type { BrokerAdapter, BarInterval } from '../types/broker.js';
import { MarketDataService } from '../services/market-data.js';
import {
  computeTechnicalIndicators,
  filterIndicators,
  type TechnicalAnalysis,
  type IndicatorType,
  type TechnicalIndicatorsConfig,
  DEFAULT_TECHNICALS_CONFIG,
} from '../services/technical-indicators.js';
import type { MCPToolDefinition, MCPToolResult } from './types.js';

// ============================================================================
// Technical Indicators Snapshot Types
// ============================================================================

/**
 * Technical indicators snapshot returned by compute_technicals tool
 */
export interface TechnicalIndicatorsSnapshot {
  /** Symbol analyzed */
  symbol: string;
  /** Current price */
  currentPrice: number;
  /** RSI indicator (if available and requested) */
  rsi?: {
    value: number;
    period: number;
    interpretation: string;
    hint: string;
  };
  /** Simple Moving Averages */
  movingAverages: {
    sma: {
      period: number;
      value: number;
      pricePosition: 'above' | 'below';
      percentDifference: number;
    }[];
    ema: {
      period: number;
      value: number;
      pricePosition: 'above' | 'below';
      percentDifference: number;
    }[];
  };
  /** ATR indicator (if available and requested) */
  atr?: {
    value: number;
    valuePercent: number;
    period: number;
    interpretation: string;
    hint: string;
  };
  /** Trend analysis */
  trend: {
    direction: 'bullish' | 'bearish' | 'neutral';
    signals: string[];
  };
  /** Human-readable interpretation hints */
  interpretations: string[];
  /** Warnings about data quality */
  warnings: string[];
  /** Request parameters used */
  request: {
    symbol: string;
    indicators: string[];
    interval: string;
    lookback: number;
  };
  /** Data timestamp */
  dataTimestamp: string;
  /** Data sources used */
  dataSources: {
    source: string;
    retrievedAt: string;
    barsAnalyzed: number;
    interval: string;
  }[];
}

// ============================================================================
// Zod Schema for Input Validation
// ============================================================================

/**
 * Schema for compute_technicals input parameters
 */
export const ComputeTechnicalsInputSchema = z.object({
  /** Symbol to analyze (required) */
  symbol: z.string().min(1, 'Symbol is required'),
  /** Indicators to compute (optional, defaults to all) */
  indicators: z
    .array(z.enum(['rsi', 'sma', 'ema', 'atr']))
    .optional()
    .default(['rsi', 'sma', 'ema', 'atr']),
  /** Bar interval (optional, defaults to daily) */
  interval: z
    .enum(['minute', '5min', '15min', 'hourly', 'daily', 'weekly', 'monthly'])
    .optional()
    .default('daily'),
  /** Number of bars to fetch (optional, defaults to 200) */
  lookback: z.number().int().positive().max(500).optional().default(200),
  /** RSI period override (optional, defaults to 14) */
  rsiPeriod: z.number().int().positive().max(50).optional(),
  /** ATR period override (optional, defaults to 14) */
  atrPeriod: z.number().int().positive().max(50).optional(),
  /** MA periods override (optional, defaults to [20, 50, 200]) */
  maPeriods: z.array(z.number().int().positive().max(500)).optional(),
});

export type ComputeTechnicalsInput = z.infer<typeof ComputeTechnicalsInputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build configuration from input parameters
 */
function buildConfig(input: ComputeTechnicalsInput): TechnicalIndicatorsConfig {
  const config: TechnicalIndicatorsConfig = {};

  if (input.rsiPeriod !== undefined) {
    config.rsiPeriod = input.rsiPeriod;
  }

  if (input.atrPeriod !== undefined) {
    config.atrPeriod = input.atrPeriod;
  }

  if (input.maPeriods !== undefined) {
    config.maPeriods = input.maPeriods;
  }

  return config;
}

/**
 * Convert RSI interpretation to hint
 */
function getRSIHint(interpretation: string): string {
  switch (interpretation) {
    case 'oversold':
      return 'RSI below 30 suggests oversold conditions. Consider this a potential buying opportunity, but confirm with other indicators.';
    case 'approaching_oversold':
      return 'RSI approaching 30. Watch for further decline into oversold territory.';
    case 'overbought':
      return 'RSI above 70 suggests overbought conditions. Be cautious with new long positions and consider taking profits.';
    case 'approaching_overbought':
      return 'RSI approaching 70. Watch for potential reversal if it exceeds overbought threshold.';
    default:
      return 'RSI in neutral zone (30-70). No extreme momentum signals.';
  }
}

/**
 * Convert ATR interpretation to hint
 */
function getATRHint(interpretation: string, atrPercent: number): string {
  switch (interpretation) {
    case 'low_volatility':
      return `Low volatility (ATR ${atrPercent.toFixed(1)}% of price). Consider tighter stop losses. Options premiums may be relatively low.`;
    case 'high_volatility':
      return `High volatility (ATR ${atrPercent.toFixed(1)}% of price). Use wider stops to avoid premature stop-outs. Options premiums likely elevated.`;
    default:
      return `Normal volatility (ATR ${atrPercent.toFixed(1)}% of price). Standard position sizing appropriate.`;
  }
}

/**
 * Convert internal TechnicalAnalysis to snapshot format
 */
function toSnapshot(
  analysis: TechnicalAnalysis,
  input: ComputeTechnicalsInput,
  brokerInfo: { name: string; type: string }
): TechnicalIndicatorsSnapshot {
  const snapshot: TechnicalIndicatorsSnapshot = {
    symbol: analysis.symbol,
    currentPrice: analysis.currentPrice,
    movingAverages: {
      sma: analysis.sma.map((ma) => ({
        period: ma.period,
        value: ma.value,
        pricePosition: (analysis.currentPrice >= ma.value ? 'above' : 'below') as 'above' | 'below',
        percentDifference:
          Math.round(((analysis.currentPrice - ma.value) / ma.value) * 10000) / 100,
      })),
      ema: analysis.ema.map((ma) => ({
        period: ma.period,
        value: ma.value,
        pricePosition: (analysis.currentPrice >= ma.value ? 'above' : 'below') as 'above' | 'below',
        percentDifference:
          Math.round(((analysis.currentPrice - ma.value) / ma.value) * 10000) / 100,
      })),
    },
    trend: {
      direction: analysis.trend.direction,
      signals: analysis.trend.signals,
    },
    interpretations: analysis.interpretations,
    warnings: analysis.warnings,
    request: {
      symbol: input.symbol,
      indicators: input.indicators,
      interval: input.interval,
      lookback: input.lookback,
    },
    dataTimestamp: analysis.dataTimestamp,
    dataSources: [
      {
        source: `${brokerInfo.name} (${brokerInfo.type})`,
        retrievedAt: new Date().toISOString(),
        barsAnalyzed: analysis.barsAnalyzed,
        interval: input.interval,
      },
    ],
  };

  // Add RSI if available
  if (analysis.rsi && input.indicators.includes('rsi')) {
    snapshot.rsi = {
      value: analysis.rsi.value,
      period: analysis.rsi.period,
      interpretation: analysis.rsi.interpretation,
      hint: getRSIHint(analysis.rsi.interpretation),
    };
  }

  // Add ATR if available
  if (analysis.atr && input.indicators.includes('atr')) {
    snapshot.atr = {
      value: analysis.atr.value,
      valuePercent: analysis.atr.valuePercent,
      period: analysis.atr.period,
      interpretation: analysis.atr.interpretation,
      hint: getATRHint(analysis.atr.interpretation, analysis.atr.valuePercent),
    };
  }

  return snapshot;
}

// ============================================================================
// Build Technical Indicators Snapshot
// ============================================================================

/**
 * Build technical indicators snapshot using broker adapter and market data service
 */
export async function buildTechnicalIndicatorsSnapshot(
  adapter: BrokerAdapter,
  input: ComputeTechnicalsInput,
  marketDataService?: MarketDataService
): Promise<TechnicalIndicatorsSnapshot> {
  // Use provided market data service or create a new one
  const marketData = marketDataService ?? new MarketDataService(adapter);

  // Fetch historical bars
  const barsResponse = await marketData.getHistoricalBars({
    symbol: input.symbol,
    interval: input.interval as BarInterval,
    limit: input.lookback,
  });

  // Build config from input
  const config = buildConfig(input);

  // Compute technical indicators
  const analysis = computeTechnicalIndicators({
    symbol: input.symbol,
    bars: barsResponse.bars,
    config,
  });

  // Convert to snapshot format
  return toSnapshot(analysis, input, {
    name: adapter.brokerName,
    type: adapter.brokerType,
  });
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

/**
 * Context required for technical indicators tool
 */
export interface TechnicalIndicatorsToolContext {
  /** Broker adapter for fetching data */
  adapter: BrokerAdapter | null;
  /** Optional market data service for caching */
  marketDataService?: MarketDataService;
}

/**
 * Create the compute_technicals tool definition
 *
 * @param context - Tool context with dependencies
 * @returns MCP tool definition
 */
export function createTechnicalIndicatorsTool(
  context: TechnicalIndicatorsToolContext
): MCPToolDefinition {
  return {
    name: 'compute_technicals',
    description: `Compute technical indicators for a symbol to assess trend and momentum.

Available indicators:
- RSI (Relative Strength Index): Momentum oscillator (0-100). Default 14-day period.
  - RSI > 70: Overbought (potential selling opportunity)
  - RSI < 30: Oversold (potential buying opportunity)

- SMA (Simple Moving Average): Trend indicator. Default periods: 20, 50, 200 days.
  - Price above MAs: Bullish
  - Price below MAs: Bearish
  - Golden cross (50 > 200): Bullish signal
  - Death cross (50 < 200): Bearish signal

- EMA (Exponential Moving Average): Like SMA but weights recent prices more heavily.

- ATR (Average True Range): Volatility indicator. Default 14-day period.
  - High ATR: High volatility, use wider stops
  - Low ATR: Low volatility, tighter stops possible

Parameters:
- symbol (required): Ticker symbol (e.g., "AAPL", "SPY")
- indicators (optional): Array of indicators to compute. Default: all
- interval (optional): Bar interval. Default: "daily"
- lookback (optional): Number of bars. Default: 200
- rsiPeriod, atrPeriod, maPeriods: Custom periods (optional)

Returns indicator values with interpretation hints for trading decisions.`,
    inputSchema: ComputeTechnicalsInputSchema,
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
        const parsedInput = ComputeTechnicalsInputSchema.parse(input);

        // Build the snapshot
        const snapshot = await buildTechnicalIndicatorsSnapshot(
          context.adapter,
          parsedInput,
          context.marketDataService
        );

        return {
          success: true,
          data: snapshot,
          timestamp: startTime.toISOString(),
          metadata: {
            symbol: snapshot.symbol,
            currentPrice: snapshot.currentPrice,
            indicatorsComputed: parsedInput.indicators,
            trendDirection: snapshot.trend.direction,
            rsiValue: snapshot.rsi?.value,
            atrPercent: snapshot.atr?.valuePercent,
            barsAnalyzed: snapshot.dataSources[0]?.barsAnalyzed ?? 0,
            warningCount: snapshot.warnings.length,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          success: false,
          error: `Failed to compute technical indicators: ${errorMessage}`,
          timestamp: startTime.toISOString(),
        };
      }
    },
  };
}

/**
 * Standalone function to compute technical indicators (for direct API use)
 *
 * @param adapter - Broker adapter
 * @param input - Request parameters
 * @param marketDataService - Optional market data service for caching
 * @returns Technical indicators snapshot
 */
export async function computeTechnicals(
  adapter: BrokerAdapter,
  input: ComputeTechnicalsInput,
  marketDataService?: MarketDataService
): Promise<TechnicalIndicatorsSnapshot> {
  return buildTechnicalIndicatorsSnapshot(adapter, input, marketDataService);
}
