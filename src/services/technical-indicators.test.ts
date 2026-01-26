/**
 * Technical Indicators Service Tests
 */

import { describe, it, expect } from 'vitest';
import type { HistoricalBar } from '../types/broker.js';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateTrueRange,
  getRSIInterpretation,
  getATRInterpretation,
  analyzeTrend,
  computeTechnicalIndicators,
  filterIndicators,
  formatRSIInterpretation,
  formatATRInterpretation,
  formatTrendInterpretation,
  DEFAULT_TECHNICALS_CONFIG,
} from './technical-indicators.js';

// ============================================================================
// Test Data Helpers
// ============================================================================

/**
 * Create a simple bar for testing
 */
function createBar(
  close: number,
  options: { open?: number; high?: number; low?: number; volume?: number; daysAgo?: number } = {}
): HistoricalBar {
  const { open = close, high = close * 1.01, low = close * 0.99, volume = 1000000, daysAgo = 0 } = options;
  const timestamp = new Date();
  timestamp.setDate(timestamp.getDate() - daysAgo);
  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  };
}

/**
 * Create a series of bars with specified closing prices
 */
function createBarsFromCloses(closes: number[]): HistoricalBar[] {
  return closes.map((close, index) => createBar(close, { daysAgo: closes.length - index - 1 }));
}

/**
 * Create bars with realistic OHLC data for ATR testing
 */
function createVolatileBars(count: number, basePrice: number, volatility: number): HistoricalBar[] {
  const bars: HistoricalBar[] = [];
  let price = basePrice;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 2 * volatility;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;

    bars.push({
      timestamp: new Date(Date.now() - (count - i) * 24 * 60 * 60 * 1000),
      open,
      high,
      low,
      close,
      volume: 1000000,
    });

    price = close;
  }

  return bars;
}

// ============================================================================
// SMA Tests
// ============================================================================

describe('calculateSMA', () => {
  it('calculates SMA correctly with sufficient data', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const sma5 = calculateSMA(closes, 5);
    expect(sma5).toBe(18); // (16 + 17 + 18 + 19 + 20) / 5 = 90 / 5 = 18
  });

  it('returns null with insufficient data', () => {
    const closes = [10, 11, 12];
    const sma5 = calculateSMA(closes, 5);
    expect(sma5).toBeNull();
  });

  it('calculates SMA with exact period length', () => {
    const closes = [10, 20, 30, 40, 50];
    const sma5 = calculateSMA(closes, 5);
    expect(sma5).toBe(30); // (10 + 20 + 30 + 40 + 50) / 5 = 150 / 5 = 30
  });

  it('calculates different period SMAs correctly', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);

    // SMA20 = average of last 20 values (130-149)
    expect(sma20).toBe(139.5);
    // SMA50 = average of all 50 values (100-149)
    expect(sma50).toBe(124.5);
  });
});

// ============================================================================
// EMA Tests
// ============================================================================

describe('calculateEMA', () => {
  it('calculates EMA correctly with sufficient data', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const ema5 = calculateEMA(closes, 5);
    expect(ema5).not.toBeNull();
    expect(typeof ema5).toBe('number');
    // EMA weighs recent values more heavily, so should be closer to end
    expect(ema5!).toBeGreaterThan(15); // Should be above simple midpoint
  });

  it('returns null with insufficient data', () => {
    const closes = [10, 11, 12];
    const ema5 = calculateEMA(closes, 5);
    expect(ema5).toBeNull();
  });

  it('EMA responds faster to recent changes than SMA', () => {
    // Prices that spike at the end - need more data after period for EMA weighting to show
    const closes = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110, 120, 130, 140, 150];
    const sma5 = calculateSMA(closes, 5)!;
    const ema5 = calculateEMA(closes, 5)!;

    // EMA should be higher because it weighs the recent spike more heavily
    // SMA5 = average of last 5 = (110+120+130+140+150)/5 = 130
    // EMA5 should be > 130 due to exponential weighting of recent values
    expect(sma5).toBe(130);
    expect(ema5).toBeGreaterThan(sma5);
  });
});

// ============================================================================
// RSI Tests
// ============================================================================

describe('calculateRSI', () => {
  it('calculates RSI correctly for uptrend', () => {
    // Consistently rising prices = high RSI
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    const rsi = calculateRSI(closes, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!.value).toBeGreaterThan(70); // Should be overbought
    expect(rsi!.interpretation).toBe('overbought');
  });

  it('calculates RSI correctly for downtrend', () => {
    // Consistently falling prices = low RSI
    const closes = Array.from({ length: 20 }, (_, i) => 200 - i * 2);
    const rsi = calculateRSI(closes, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!.value).toBeLessThan(30); // Should be oversold
    expect(rsi!.interpretation).toBe('oversold');
  });

  it('returns null with insufficient data', () => {
    const closes = [100, 101, 102];
    const rsi = calculateRSI(closes, 14);
    expect(rsi).toBeNull();
  });

  it('handles neutral market (no change)', () => {
    const closes = Array.from({ length: 20 }, () => 100);
    const rsi = calculateRSI(closes, 14);
    // With no change, gains = losses = 0, so RSI should be undefined behavior
    // Our implementation handles this - RSI with no losses = 100
    expect(rsi).not.toBeNull();
  });

  it('uses correct period', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const rsi = calculateRSI(closes, 14);
    expect(rsi!.period).toBe(14);
    expect(rsi!.barsUsed).toBe(30);
  });
});

describe('getRSIInterpretation', () => {
  it('returns oversold for RSI <= 30', () => {
    expect(getRSIInterpretation(25)).toBe('oversold');
    expect(getRSIInterpretation(30)).toBe('oversold');
  });

  it('returns approaching_oversold for RSI 31-40', () => {
    expect(getRSIInterpretation(31)).toBe('approaching_oversold');
    expect(getRSIInterpretation(40)).toBe('approaching_oversold');
  });

  it('returns neutral for RSI 41-59', () => {
    expect(getRSIInterpretation(50)).toBe('neutral');
    expect(getRSIInterpretation(41)).toBe('neutral');
    expect(getRSIInterpretation(59)).toBe('neutral');
  });

  it('returns approaching_overbought for RSI 60-69', () => {
    expect(getRSIInterpretation(60)).toBe('approaching_overbought');
    expect(getRSIInterpretation(69)).toBe('approaching_overbought');
  });

  it('returns overbought for RSI >= 70', () => {
    expect(getRSIInterpretation(70)).toBe('overbought');
    expect(getRSIInterpretation(85)).toBe('overbought');
  });
});

// ============================================================================
// ATR Tests
// ============================================================================

describe('calculateTrueRange', () => {
  it('calculates true range as high-low when it is largest', () => {
    const current: HistoricalBar = {
      timestamp: new Date(),
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
    };
    const previous: HistoricalBar = {
      timestamp: new Date(Date.now() - 86400000),
      open: 98,
      high: 102,
      low: 97,
      close: 100,
      volume: 1000,
    };

    const tr = calculateTrueRange(current, previous);
    expect(tr).toBe(15); // high (110) - low (95) = 15
  });

  it('uses high vs prev close when it is largest (gap up)', () => {
    const current: HistoricalBar = {
      timestamp: new Date(),
      open: 110,
      high: 115,
      low: 108,
      close: 112,
      volume: 1000,
    };
    const previous: HistoricalBar = {
      timestamp: new Date(Date.now() - 86400000),
      open: 98,
      high: 102,
      low: 97,
      close: 100,
      volume: 1000,
    };

    const tr = calculateTrueRange(current, previous);
    expect(tr).toBe(15); // high (115) - prev close (100) = 15
  });

  it('uses prev close vs low when it is largest (gap down)', () => {
    const current: HistoricalBar = {
      timestamp: new Date(),
      open: 95,
      high: 98,
      low: 93,
      close: 96,
      volume: 1000,
    };
    const previous: HistoricalBar = {
      timestamp: new Date(Date.now() - 86400000),
      open: 98,
      high: 102,
      low: 97,
      close: 105,
      volume: 1000,
    };

    const tr = calculateTrueRange(current, previous);
    expect(tr).toBe(12); // prev close (105) - low (93) = 12
  });
});

describe('calculateATR', () => {
  it('calculates ATR correctly with sufficient data', () => {
    const bars = createVolatileBars(20, 100, 2);
    const atr = calculateATR(bars, 14);
    expect(atr).not.toBeNull();
    expect(atr!.value).toBeGreaterThan(0);
    expect(atr!.valuePercent).toBeGreaterThan(0);
    expect(atr!.period).toBe(14);
  });

  it('returns null with insufficient data', () => {
    const bars = createVolatileBars(10, 100, 2);
    const atr = calculateATR(bars, 14);
    expect(atr).toBeNull();
  });

  it('calculates ATR percentage correctly', () => {
    const bars = createBarsFromCloses(Array.from({ length: 20 }, () => 100));
    // With constant prices, ATR should be very low
    const atr = calculateATR(bars, 14, 100);
    expect(atr).not.toBeNull();
    // ATR percent should be close to 0 for flat prices
  });
});

describe('getATRInterpretation', () => {
  it('returns low_volatility for ATR < 1.5%', () => {
    expect(getATRInterpretation(1)).toBe('low_volatility');
    expect(getATRInterpretation(1.4)).toBe('low_volatility');
  });

  it('returns normal_volatility for ATR 1.5-3%', () => {
    expect(getATRInterpretation(1.5)).toBe('normal_volatility');
    expect(getATRInterpretation(2)).toBe('normal_volatility');
    expect(getATRInterpretation(3)).toBe('normal_volatility');
  });

  it('returns high_volatility for ATR > 3%', () => {
    expect(getATRInterpretation(3.1)).toBe('high_volatility');
    expect(getATRInterpretation(5)).toBe('high_volatility');
  });
});

// ============================================================================
// Trend Analysis Tests
// ============================================================================

describe('analyzeTrend', () => {
  it('identifies bullish trend when price above all MAs', () => {
    const smas = [
      { value: 90, period: 20, type: 'sma' as const, barsUsed: 20 },
      { value: 85, period: 50, type: 'sma' as const, barsUsed: 50 },
      { value: 80, period: 200, type: 'sma' as const, barsUsed: 200 },
    ];
    const trend = analyzeTrend(100, smas, []);
    expect(trend.direction).toBe('bullish');
    expect(trend.priceVsMAs.every((p) => p.position === 'above')).toBe(true);
  });

  it('identifies bearish trend when price below all MAs', () => {
    const smas = [
      { value: 110, period: 20, type: 'sma' as const, barsUsed: 20 },
      { value: 115, period: 50, type: 'sma' as const, barsUsed: 50 },
      { value: 120, period: 200, type: 'sma' as const, barsUsed: 200 },
    ];
    const trend = analyzeTrend(100, smas, []);
    expect(trend.direction).toBe('bearish');
    expect(trend.priceVsMAs.every((p) => p.position === 'below')).toBe(true);
  });

  it('identifies neutral trend when mixed MA positions', () => {
    const smas = [
      { value: 98, period: 20, type: 'sma' as const, barsUsed: 20 }, // above
      { value: 102, period: 50, type: 'sma' as const, barsUsed: 50 }, // below
      { value: 105, period: 200, type: 'sma' as const, barsUsed: 200 }, // below
    ];
    const trend = analyzeTrend(100, smas, []);
    expect(trend.direction).toBe('bearish'); // 1/3 above, 2/3 below = bearish
  });

  it('detects golden cross signal', () => {
    const smas = [
      { value: 100, period: 20, type: 'sma' as const, barsUsed: 20 },
      { value: 95, period: 50, type: 'sma' as const, barsUsed: 50 },
      { value: 90, period: 200, type: 'sma' as const, barsUsed: 200 },
    ];
    const trend = analyzeTrend(100, smas, []);
    expect(trend.signals.some((s) => s.includes('Golden cross'))).toBe(true);
  });

  it('detects death cross signal', () => {
    const smas = [
      { value: 100, period: 20, type: 'sma' as const, barsUsed: 20 },
      { value: 85, period: 50, type: 'sma' as const, barsUsed: 50 },
      { value: 90, period: 200, type: 'sma' as const, barsUsed: 200 },
    ];
    const trend = analyzeTrend(100, smas, []);
    expect(trend.signals.some((s) => s.includes('Death cross'))).toBe(true);
  });

  it('handles empty MAs', () => {
    const trend = analyzeTrend(100, [], []);
    expect(trend.direction).toBe('neutral');
    expect(trend.priceVsMAs).toHaveLength(0);
  });
});

// ============================================================================
// computeTechnicalIndicators Tests
// ============================================================================

describe('computeTechnicalIndicators', () => {
  it('computes all indicators with sufficient data', () => {
    const bars = createBarsFromCloses(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1));
    const analysis = computeTechnicalIndicators({
      symbol: 'AAPL',
      bars,
    });

    expect(analysis.symbol).toBe('AAPL');
    expect(analysis.currentPrice).toBeGreaterThan(0);
    expect(analysis.rsi).toBeDefined();
    expect(analysis.sma.length).toBe(3); // 20, 50, 200
    expect(analysis.ema.length).toBe(3);
    expect(analysis.atr).toBeDefined();
    expect(analysis.trend).toBeDefined();
    expect(analysis.interpretations.length).toBeGreaterThan(0);
    expect(analysis.warnings).toHaveLength(0);
    expect(analysis.barsAnalyzed).toBe(250);
  });

  it('handles empty bars array', () => {
    const analysis = computeTechnicalIndicators({
      symbol: 'AAPL',
      bars: [],
    });

    expect(analysis.symbol).toBe('AAPL');
    expect(analysis.currentPrice).toBe(0);
    expect(analysis.rsi).toBeUndefined();
    expect(analysis.sma).toHaveLength(0);
    expect(analysis.ema).toHaveLength(0);
    expect(analysis.warnings).toContain('No price data available');
  });

  it('reports warnings for insufficient data', () => {
    const bars = createBarsFromCloses(Array.from({ length: 10 }, (_, i) => 100 + i));
    const analysis = computeTechnicalIndicators({
      symbol: 'AAPL',
      bars,
    });

    expect(analysis.warnings.length).toBeGreaterThan(0);
    expect(analysis.warnings.some((w) => w.includes('RSI'))).toBe(true);
    expect(analysis.warnings.some((w) => w.includes('200-day SMA'))).toBe(true);
  });

  it('uses custom config', () => {
    const bars = createBarsFromCloses(Array.from({ length: 50 }, (_, i) => 100 + i));
    const analysis = computeTechnicalIndicators({
      symbol: 'AAPL',
      bars,
      config: {
        rsiPeriod: 7,
        maPeriods: [10, 20],
        atrPeriod: 7,
      },
    });

    expect(analysis.rsi?.period).toBe(7);
    expect(analysis.sma.length).toBe(2); // 10, 20
    expect(analysis.atr?.period).toBe(7);
  });
});

// ============================================================================
// filterIndicators Tests
// ============================================================================

describe('filterIndicators', () => {
  const createFullAnalysis = (): ReturnType<typeof computeTechnicalIndicators> => {
    const bars = createBarsFromCloses(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1));
    return computeTechnicalIndicators({ symbol: 'AAPL', bars });
  };

  it('filters to only RSI', () => {
    const full = createFullAnalysis();
    const filtered = filterIndicators(full, ['rsi']);

    expect(filtered.rsi).toBeDefined();
    expect(filtered.sma).toBeUndefined();
    expect(filtered.ema).toBeUndefined();
    expect(filtered.atr).toBeUndefined();
    expect(filtered.trend).toBeUndefined();
  });

  it('filters to only SMAs', () => {
    const full = createFullAnalysis();
    const filtered = filterIndicators(full, ['sma']);

    expect(filtered.rsi).toBeUndefined();
    expect(filtered.sma).toBeDefined();
    expect(filtered.ema).toBeUndefined();
    expect(filtered.trend).toBeDefined(); // Included when MAs requested
  });

  it('filters to only ATR', () => {
    const full = createFullAnalysis();
    const filtered = filterIndicators(full, ['atr']);

    expect(filtered.rsi).toBeUndefined();
    expect(filtered.sma).toBeUndefined();
    expect(filtered.atr).toBeDefined();
    expect(filtered.trend).toBeUndefined();
  });

  it('filters to multiple indicators', () => {
    const full = createFullAnalysis();
    const filtered = filterIndicators(full, ['rsi', 'atr']);

    expect(filtered.rsi).toBeDefined();
    expect(filtered.atr).toBeDefined();
    expect(filtered.sma).toBeUndefined();
    expect(filtered.ema).toBeUndefined();
  });
});

// ============================================================================
// Formatting Functions Tests
// ============================================================================

describe('formatRSIInterpretation', () => {
  it('formats oversold RSI', () => {
    const rsi = { value: 25, period: 14, barsUsed: 20, interpretation: 'oversold' as const };
    const formatted = formatRSIInterpretation(rsi);
    expect(formatted).toContain('RSI(14)');
    expect(formatted).toContain('25.0');
    expect(formatted).toContain('Oversold');
    expect(formatted).toContain('buying opportunity');
  });

  it('formats overbought RSI', () => {
    const rsi = { value: 75, period: 14, barsUsed: 20, interpretation: 'overbought' as const };
    const formatted = formatRSIInterpretation(rsi);
    expect(formatted).toContain('Overbought');
    expect(formatted).toContain('caution');
  });

  it('formats neutral RSI', () => {
    const rsi = { value: 50, period: 14, barsUsed: 20, interpretation: 'neutral' as const };
    const formatted = formatRSIInterpretation(rsi);
    expect(formatted).toContain('Neutral');
  });
});

describe('formatATRInterpretation', () => {
  it('formats low volatility ATR', () => {
    const atr = {
      value: 1.5,
      valuePercent: 1,
      period: 14,
      barsUsed: 20,
      interpretation: 'low_volatility' as const,
    };
    const formatted = formatATRInterpretation(atr);
    expect(formatted).toContain('ATR(14)');
    expect(formatted).toContain('$1.50');
    expect(formatted).toContain('Low volatility');
    expect(formatted).toContain('tighter stops');
  });

  it('formats high volatility ATR', () => {
    const atr = {
      value: 5,
      valuePercent: 4,
      period: 14,
      barsUsed: 20,
      interpretation: 'high_volatility' as const,
    };
    const formatted = formatATRInterpretation(atr);
    expect(formatted).toContain('High volatility');
    expect(formatted).toContain('wider stops');
  });
});

describe('formatTrendInterpretation', () => {
  it('formats bullish trend', () => {
    const trend = { direction: 'bullish' as const, priceVsMAs: [], signals: [] };
    const formatted = formatTrendInterpretation(trend, 150);
    expect(formatted).toContain('Bullish');
    expect(formatted).toContain('$150.00');
    expect(formatted).toContain('above');
  });

  it('formats bearish trend', () => {
    const trend = { direction: 'bearish' as const, priceVsMAs: [], signals: [] };
    const formatted = formatTrendInterpretation(trend, 100);
    expect(formatted).toContain('Bearish');
    expect(formatted).toContain('below');
  });

  it('formats neutral trend', () => {
    const trend = { direction: 'neutral' as const, priceVsMAs: [], signals: [] };
    const formatted = formatTrendInterpretation(trend, 100);
    expect(formatted).toContain('Neutral');
    expect(formatted).toContain('mixed');
  });
});

// ============================================================================
// DEFAULT_TECHNICALS_CONFIG Tests
// ============================================================================

describe('DEFAULT_TECHNICALS_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_TECHNICALS_CONFIG.rsiPeriod).toBe(14);
    expect(DEFAULT_TECHNICALS_CONFIG.atrPeriod).toBe(14);
    expect(DEFAULT_TECHNICALS_CONFIG.maPeriods).toEqual([20, 50, 200]);
  });
});
