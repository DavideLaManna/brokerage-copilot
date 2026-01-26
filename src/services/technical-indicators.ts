/**
 * Technical Indicators Service
 *
 * Calculates common technical indicators for trading analysis:
 * - RSI (Relative Strength Index)
 * - Moving Averages (SMA, EMA)
 * - ATR (Average True Range)
 *
 * All indicators include interpretation hints for LLM agents.
 */

import type { HistoricalBar } from '../types/broker.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for technical indicator calculations
 */
export interface TechnicalIndicatorsConfig {
  /** RSI period (default: 14) */
  rsiPeriod?: number;
  /** Moving average periods to calculate */
  maPeriods?: number[];
  /** ATR period (default: 14) */
  atrPeriod?: number;
}

export const DEFAULT_TECHNICALS_CONFIG: Required<TechnicalIndicatorsConfig> = {
  rsiPeriod: 14,
  maPeriods: [20, 50, 200],
  atrPeriod: 14,
};

// ============================================================================
// Indicator Result Types
// ============================================================================

/**
 * RSI indicator result
 */
export interface RSIResult {
  /** RSI value (0-100) */
  value: number;
  /** RSI period used */
  period: number;
  /** Number of bars used in calculation */
  barsUsed: number;
  /** Interpretation hint */
  interpretation: RSIInterpretation;
}

export type RSIInterpretation =
  | 'oversold'
  | 'approaching_oversold'
  | 'neutral'
  | 'approaching_overbought'
  | 'overbought';

/**
 * Moving average result
 */
export interface MovingAverageResult {
  /** Moving average value */
  value: number;
  /** Period used */
  period: number;
  /** Type of MA (SMA or EMA) */
  type: 'sma' | 'ema';
  /** Number of bars used */
  barsUsed: number;
}

/**
 * ATR (Average True Range) result
 */
export interface ATRResult {
  /** ATR value (absolute price range) */
  value: number;
  /** ATR as percentage of current price */
  valuePercent: number;
  /** Period used */
  period: number;
  /** Number of bars used */
  barsUsed: number;
  /** Interpretation hint */
  interpretation: ATRInterpretation;
}

export type ATRInterpretation = 'low_volatility' | 'normal_volatility' | 'high_volatility';

/**
 * Trend analysis based on moving averages
 */
export interface TrendAnalysis {
  /** Overall trend direction */
  direction: 'bullish' | 'bearish' | 'neutral';
  /** Current price relative to MAs */
  priceVsMAs: {
    ma: number;
    price: number;
    position: 'above' | 'below';
    percentDifference: number;
  }[];
  /** MA crossover signals */
  signals: string[];
}

/**
 * Complete technical analysis result
 */
export interface TechnicalAnalysis {
  /** Symbol analyzed */
  symbol: string;
  /** Current price (last bar close) */
  currentPrice: number;
  /** RSI indicator (if available) */
  rsi?: RSIResult;
  /** Simple Moving Averages */
  sma: MovingAverageResult[];
  /** Exponential Moving Averages */
  ema: MovingAverageResult[];
  /** ATR indicator (if available) */
  atr?: ATRResult;
  /** Trend analysis */
  trend: TrendAnalysis;
  /** Human-readable interpretation hints */
  interpretations: string[];
  /** Warnings (e.g., insufficient data) */
  warnings: string[];
  /** Data timestamp */
  dataTimestamp: string;
  /** Number of bars analyzed */
  barsAnalyzed: number;
}

// ============================================================================
// Indicator Calculation Functions
// ============================================================================

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(closes: number[], period: number): number | null {
  if (closes.length < period) {
    return null;
  }

  const relevantCloses = closes.slice(-period);
  const sum = relevantCloses.reduce((acc, val) => acc + val, 0);
  return sum / period;
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(closes: number[], period: number): number | null {
  if (closes.length < period) {
    return null;
  }

  // Calculate initial SMA for the first period
  const initialSMA = closes.slice(0, period).reduce((acc, val) => acc + val, 0) / period;

  // EMA multiplier: 2 / (period + 1)
  const multiplier = 2 / (period + 1);

  // Calculate EMA from the initial SMA
  let ema = initialSMA;
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i]! - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate RSI (Relative Strength Index)
 *
 * RSI = 100 - (100 / (1 + RS))
 * RS = Average Gain / Average Loss over period
 */
export function calculateRSI(closes: number[], period: number = 14): RSIResult | null {
  // Need at least period + 1 prices to calculate RSI
  if (closes.length < period + 1) {
    return null;
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i]! - closes[i - 1]!);
  }

  // Separate gains and losses
  const gains: number[] = [];
  const losses: number[] = [];
  for (const change of changes) {
    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }
  }

  // Calculate initial average gain/loss using simple average
  let avgGain = gains.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((acc, val) => acc + val, 0) / period;

  // Calculate smoothed average using Wilder's smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
  }

  // Calculate RS and RSI
  let rsi: number;
  if (avgLoss === 0) {
    rsi = 100; // No losses = RSI of 100
  } else {
    const rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
  }

  return {
    value: Math.round(rsi * 100) / 100,
    period,
    barsUsed: closes.length,
    interpretation: getRSIInterpretation(rsi),
  };
}

/**
 * Get RSI interpretation
 */
export function getRSIInterpretation(rsi: number): RSIInterpretation {
  if (rsi <= 30) {
    return 'oversold';
  } else if (rsi <= 40) {
    return 'approaching_oversold';
  } else if (rsi >= 70) {
    return 'overbought';
  } else if (rsi >= 60) {
    return 'approaching_overbought';
  }
  return 'neutral';
}

/**
 * Calculate True Range for a single bar
 *
 * TR = max(High - Low, |High - Previous Close|, |Low - Previous Close|)
 */
export function calculateTrueRange(
  currentBar: HistoricalBar,
  previousBar: HistoricalBar
): number {
  const highLow = currentBar.high - currentBar.low;
  const highPrevClose = Math.abs(currentBar.high - previousBar.close);
  const lowPrevClose = Math.abs(currentBar.low - previousBar.close);
  return Math.max(highLow, highPrevClose, lowPrevClose);
}

/**
 * Calculate ATR (Average True Range)
 */
export function calculateATR(
  bars: HistoricalBar[],
  period: number = 14,
  currentPrice?: number
): ATRResult | null {
  // Need at least period + 1 bars for ATR
  if (bars.length < period + 1) {
    return null;
  }

  // Calculate true ranges
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    trueRanges.push(calculateTrueRange(bars[i]!, bars[i - 1]!));
  }

  // Calculate initial ATR using simple average
  let atr = trueRanges.slice(0, period).reduce((acc, val) => acc + val, 0) / period;

  // Calculate smoothed ATR using Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }

  // Use last bar's close if currentPrice not provided
  const price = currentPrice ?? bars[bars.length - 1]!.close;
  const atrPercent = (atr / price) * 100;

  return {
    value: Math.round(atr * 100) / 100,
    valuePercent: Math.round(atrPercent * 100) / 100,
    period,
    barsUsed: bars.length,
    interpretation: getATRInterpretation(atrPercent),
  };
}

/**
 * Get ATR interpretation based on percentage
 */
export function getATRInterpretation(atrPercent: number): ATRInterpretation {
  // These thresholds are general guidelines
  // Low volatility: ATR < 1.5% of price
  // Normal: 1.5% - 3%
  // High: > 3%
  if (atrPercent < 1.5) {
    return 'low_volatility';
  } else if (atrPercent > 3) {
    return 'high_volatility';
  }
  return 'normal_volatility';
}

/**
 * Analyze trend based on moving averages
 */
export function analyzeTrend(
  currentPrice: number,
  smas: MovingAverageResult[],
  emas: MovingAverageResult[]
): TrendAnalysis {
  const allMAs = [...smas, ...emas].sort((a, b) => a.period - b.period);

  // Calculate price position relative to each MA
  const priceVsMAs = allMAs.map((ma) => ({
    ma: ma.period,
    price: currentPrice,
    position: (currentPrice >= ma.value ? 'above' : 'below') as 'above' | 'below',
    percentDifference: Math.round(((currentPrice - ma.value) / ma.value) * 10000) / 100,
  }));

  // Determine overall trend direction
  const aboveCount = priceVsMAs.filter((p) => p.position === 'above').length;
  const totalCount = priceVsMAs.length;

  let direction: 'bullish' | 'bearish' | 'neutral';
  if (totalCount === 0) {
    direction = 'neutral';
  } else if (aboveCount === totalCount) {
    direction = 'bullish';
  } else if (aboveCount === 0) {
    direction = 'bearish';
  } else if (aboveCount >= totalCount * 0.6) {
    direction = 'bullish';
  } else if (aboveCount <= totalCount * 0.4) {
    direction = 'bearish';
  } else {
    direction = 'neutral';
  }

  // Generate signals
  const signals: string[] = [];

  // Check for golden cross / death cross (50 MA vs 200 MA)
  const sma50 = smas.find((ma) => ma.period === 50);
  const sma200 = smas.find((ma) => ma.period === 200);
  if (sma50 && sma200) {
    if (sma50.value > sma200.value) {
      signals.push('Golden cross: 50-day SMA above 200-day SMA (bullish)');
    } else {
      signals.push('Death cross: 50-day SMA below 200-day SMA (bearish)');
    }
  }

  // Check price vs key MAs
  const sma20 = smas.find((ma) => ma.period === 20);
  if (sma20) {
    const pctDiff = ((currentPrice - sma20.value) / sma20.value) * 100;
    if (pctDiff > 5) {
      signals.push(`Price extended ${pctDiff.toFixed(1)}% above 20-day SMA (potential pullback)`);
    } else if (pctDiff < -5) {
      signals.push(`Price extended ${Math.abs(pctDiff).toFixed(1)}% below 20-day SMA (potential bounce)`);
    }
  }

  return {
    direction,
    priceVsMAs,
    signals,
  };
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Input parameters for technical analysis
 */
export interface ComputeTechnicalsInput {
  /** Symbol being analyzed */
  symbol: string;
  /** Historical price bars */
  bars: HistoricalBar[];
  /** Optional configuration overrides */
  config?: TechnicalIndicatorsConfig;
}

/**
 * Compute comprehensive technical analysis for a symbol
 *
 * @param input - Analysis input parameters
 * @returns Complete technical analysis with interpretations
 */
export function computeTechnicalIndicators(input: ComputeTechnicalsInput): TechnicalAnalysis {
  const { symbol, bars, config = {} } = input;
  const mergedConfig = { ...DEFAULT_TECHNICALS_CONFIG, ...config };

  const warnings: string[] = [];
  const interpretations: string[] = [];

  if (bars.length === 0) {
    return {
      symbol,
      currentPrice: 0,
      sma: [],
      ema: [],
      trend: { direction: 'neutral', priceVsMAs: [], signals: [] },
      interpretations: [],
      warnings: ['No price data available'],
      dataTimestamp: new Date().toISOString(),
      barsAnalyzed: 0,
    };
  }

  // Extract closing prices for calculations
  const closes = bars.map((bar) => bar.close);
  const currentPrice = closes[closes.length - 1]!;
  const dataTimestamp = bars[bars.length - 1]!.timestamp.toISOString();

  // Calculate RSI
  let rsi: RSIResult | undefined;
  const rsiResult = calculateRSI(closes, mergedConfig.rsiPeriod);
  if (rsiResult) {
    rsi = rsiResult;
    interpretations.push(formatRSIInterpretation(rsi));
  } else {
    warnings.push(
      `Insufficient data for RSI (need ${mergedConfig.rsiPeriod + 1} bars, have ${bars.length})`
    );
  }

  // Calculate SMAs
  const smaResults: MovingAverageResult[] = [];
  for (const period of mergedConfig.maPeriods) {
    const smaValue = calculateSMA(closes, period);
    if (smaValue !== null) {
      smaResults.push({
        value: Math.round(smaValue * 100) / 100,
        period,
        type: 'sma',
        barsUsed: Math.min(closes.length, period),
      });
    } else {
      warnings.push(`Insufficient data for ${period}-day SMA (need ${period} bars, have ${bars.length})`);
    }
  }

  // Calculate EMAs
  const emaResults: MovingAverageResult[] = [];
  for (const period of mergedConfig.maPeriods) {
    const emaValue = calculateEMA(closes, period);
    if (emaValue !== null) {
      emaResults.push({
        value: Math.round(emaValue * 100) / 100,
        period,
        type: 'ema',
        barsUsed: closes.length,
      });
    }
  }

  // Calculate ATR
  let atr: ATRResult | undefined;
  const atrResult = calculateATR(bars, mergedConfig.atrPeriod, currentPrice);
  if (atrResult) {
    atr = atrResult;
    interpretations.push(formatATRInterpretation(atr));
  } else {
    warnings.push(
      `Insufficient data for ATR (need ${mergedConfig.atrPeriod + 1} bars, have ${bars.length})`
    );
  }

  // Analyze trend
  const trend = analyzeTrend(currentPrice, smaResults, emaResults);
  interpretations.push(formatTrendInterpretation(trend, currentPrice));

  // Add trend signals to interpretations
  for (const signal of trend.signals) {
    interpretations.push(signal);
  }

  return {
    symbol,
    currentPrice: Math.round(currentPrice * 100) / 100,
    rsi,
    sma: smaResults,
    ema: emaResults,
    atr,
    trend,
    interpretations,
    warnings,
    dataTimestamp,
    barsAnalyzed: bars.length,
  };
}

// ============================================================================
// Interpretation Formatting Functions
// ============================================================================

/**
 * Format RSI interpretation as human-readable text
 */
export function formatRSIInterpretation(rsi: RSIResult): string {
  const value = rsi.value.toFixed(1);
  switch (rsi.interpretation) {
    case 'oversold':
      return `RSI(${rsi.period}) at ${value}: Oversold conditions - potential buying opportunity`;
    case 'approaching_oversold':
      return `RSI(${rsi.period}) at ${value}: Approaching oversold territory`;
    case 'overbought':
      return `RSI(${rsi.period}) at ${value}: Overbought conditions - caution for longs`;
    case 'approaching_overbought':
      return `RSI(${rsi.period}) at ${value}: Approaching overbought territory`;
    case 'neutral':
      return `RSI(${rsi.period}) at ${value}: Neutral momentum`;
  }
}

/**
 * Format ATR interpretation as human-readable text
 */
export function formatATRInterpretation(atr: ATRResult): string {
  const value = atr.value.toFixed(2);
  const pct = atr.valuePercent.toFixed(1);
  switch (atr.interpretation) {
    case 'low_volatility':
      return `ATR(${atr.period}) at $${value} (${pct}%): Low volatility - tighter stops possible`;
    case 'high_volatility':
      return `ATR(${atr.period}) at $${value} (${pct}%): High volatility - wider stops needed`;
    case 'normal_volatility':
      return `ATR(${atr.period}) at $${value} (${pct}%): Normal volatility`;
  }
}

/**
 * Format trend interpretation as human-readable text
 */
export function formatTrendInterpretation(trend: TrendAnalysis, currentPrice: number): string {
  const priceStr = currentPrice.toFixed(2);
  switch (trend.direction) {
    case 'bullish':
      return `Trend: Bullish - Price ($${priceStr}) trading above key moving averages`;
    case 'bearish':
      return `Trend: Bearish - Price ($${priceStr}) trading below key moving averages`;
    case 'neutral':
      return `Trend: Neutral - Price ($${priceStr}) mixed relative to moving averages`;
  }
}

/**
 * Get indicator name for a specific type
 */
export type IndicatorType = 'rsi' | 'sma' | 'ema' | 'atr';

/**
 * Filter technical analysis to only requested indicators
 */
export function filterIndicators(
  analysis: TechnicalAnalysis,
  indicators: IndicatorType[]
): Partial<TechnicalAnalysis> {
  const result: Partial<TechnicalAnalysis> = {
    symbol: analysis.symbol,
    currentPrice: analysis.currentPrice,
    dataTimestamp: analysis.dataTimestamp,
    barsAnalyzed: analysis.barsAnalyzed,
    warnings: [],
    interpretations: [],
  };

  if (indicators.includes('rsi') && analysis.rsi) {
    result.rsi = analysis.rsi;
    result.interpretations!.push(formatRSIInterpretation(analysis.rsi));
  }

  if (indicators.includes('sma')) {
    result.sma = analysis.sma;
  }

  if (indicators.includes('ema')) {
    result.ema = analysis.ema;
  }

  if (indicators.includes('atr') && analysis.atr) {
    result.atr = analysis.atr;
    result.interpretations!.push(formatATRInterpretation(analysis.atr));
  }

  // Always include trend if any MA is requested
  if (indicators.includes('sma') || indicators.includes('ema')) {
    result.trend = analysis.trend;
    result.interpretations!.push(formatTrendInterpretation(analysis.trend, analysis.currentPrice));
  }

  // Filter warnings to only relevant indicators
  const warningFilters: Record<IndicatorType, RegExp> = {
    rsi: /RSI/i,
    sma: /SMA/i,
    ema: /EMA/i,
    atr: /ATR/i,
  };

  result.warnings = analysis.warnings.filter((warning) =>
    indicators.some((ind) => warningFilters[ind].test(warning))
  );

  return result;
}
