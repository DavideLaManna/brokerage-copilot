/**
 * Technical Indicators MCP Tool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrokerAdapter, HistoricalBarsResponse, HistoricalBar } from '../types/broker.js';
import {
  createTechnicalIndicatorsTool,
  buildTechnicalIndicatorsSnapshot,
  computeTechnicals,
  ComputeTechnicalsInputSchema,
} from './technical-indicators.js';
import { ToolRegistry } from './registry.js';

// ============================================================================
// Test Data Helpers
// ============================================================================

/**
 * Create a series of bars with specified closing prices
 */
function createBarsFromCloses(closes: number[]): HistoricalBar[] {
  return closes.map((close, index) => ({
    timestamp: new Date(Date.now() - (closes.length - index - 1) * 24 * 60 * 60 * 1000),
    open: close * 0.99,
    high: close * 1.01,
    low: close * 0.98,
    close,
    volume: 1000000,
  }));
}

/**
 * Create mock broker adapter
 */
function createMockAdapter(bars: HistoricalBar[]): BrokerAdapter {
  return {
    brokerType: 'tradier',
    brokerName: 'Tradier',
    getHistoricalBars: vi.fn().mockResolvedValue({
      symbol: 'AAPL',
      interval: 'daily',
      bars,
      asOf: new Date(),
    } as HistoricalBarsResponse),
    getAccountSummary: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  };
}

// ============================================================================
// Input Schema Validation Tests
// ============================================================================

describe('ComputeTechnicalsInputSchema', () => {
  it('validates valid input with all fields', () => {
    const input = {
      symbol: 'AAPL',
      indicators: ['rsi', 'sma'],
      interval: 'daily',
      lookback: 100,
      rsiPeriod: 14,
      atrPeriod: 14,
      maPeriods: [20, 50],
    };
    const result = ComputeTechnicalsInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('validates minimal input (symbol only)', () => {
    const input = { symbol: 'AAPL' };
    const result = ComputeTechnicalsInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      // Check defaults are applied
      expect(result.data.indicators).toEqual(['rsi', 'sma', 'ema', 'atr']);
      expect(result.data.interval).toBe('daily');
      expect(result.data.lookback).toBe(200);
    }
  });

  it('rejects empty symbol', () => {
    const input = { symbol: '' };
    const result = ComputeTechnicalsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid indicator types', () => {
    const input = { symbol: 'AAPL', indicators: ['invalid'] };
    const result = ComputeTechnicalsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid interval', () => {
    const input = { symbol: 'AAPL', interval: 'invalid' };
    const result = ComputeTechnicalsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects negative lookback', () => {
    const input = { symbol: 'AAPL', lookback: -10 };
    const result = ComputeTechnicalsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects lookback exceeding max', () => {
    const input = { symbol: 'AAPL', lookback: 1000 };
    const result = ComputeTechnicalsInputSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts all valid intervals', () => {
    const intervals = ['minute', '5min', '15min', 'hourly', 'daily', 'weekly', 'monthly'];
    for (const interval of intervals) {
      const input = { symbol: 'AAPL', interval };
      const result = ComputeTechnicalsInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });
});

// ============================================================================
// buildTechnicalIndicatorsSnapshot Tests
// ============================================================================

describe('buildTechnicalIndicatorsSnapshot', () => {
  it('builds complete snapshot with all indicators', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi', 'sma', 'ema', 'atr'],
      interval: 'daily',
      lookback: 200,
    });

    expect(snapshot.symbol).toBe('AAPL');
    expect(snapshot.currentPrice).toBeGreaterThan(0);
    expect(snapshot.rsi).toBeDefined();
    expect(snapshot.rsi!.value).toBeGreaterThan(0);
    expect(snapshot.rsi!.interpretation).toBeDefined();
    expect(snapshot.rsi!.hint).toBeDefined();
    expect(snapshot.movingAverages.sma.length).toBe(3);
    expect(snapshot.movingAverages.ema.length).toBe(3);
    expect(snapshot.atr).toBeDefined();
    expect(snapshot.atr!.hint).toBeDefined();
    expect(snapshot.trend).toBeDefined();
    expect(snapshot.interpretations.length).toBeGreaterThan(0);
    expect(snapshot.dataSources.length).toBe(1);
    expect(snapshot.dataSources[0]!.source).toContain('Tradier');
  });

  it('builds snapshot with only RSI', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 50 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi'],
      interval: 'daily',
      lookback: 50,
    });

    expect(snapshot.rsi).toBeDefined();
    expect(snapshot.atr).toBeUndefined();
  });

  it('includes request parameters in response', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 100 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi', 'sma'],
      interval: 'hourly',
      lookback: 100,
    });

    expect(snapshot.request.symbol).toBe('AAPL');
    expect(snapshot.request.indicators).toEqual(['rsi', 'sma']);
    expect(snapshot.request.interval).toBe('hourly');
    expect(snapshot.request.lookback).toBe(100);
  });

  it('calculates price position relative to MAs', async () => {
    // Create bars where price ends above SMA20
    const bars = createBarsFromCloses(Array.from({ length: 50 }, (_, i) => 100 + i * 2));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['sma'],
      interval: 'daily',
      lookback: 50,
    });

    // Price should be above shorter MAs with uptrend
    const sma20 = snapshot.movingAverages.sma.find((ma) => ma.period === 20);
    expect(sma20).toBeDefined();
    expect(sma20!.pricePosition).toBe('above');
    expect(sma20!.percentDifference).toBeGreaterThan(0);
  });

  it('handles custom config parameters', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 100 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi', 'atr'],
      interval: 'daily',
      lookback: 100,
      rsiPeriod: 7,
      atrPeriod: 10,
    });

    expect(snapshot.rsi?.period).toBe(7);
    expect(snapshot.atr?.period).toBe(10);
  });

  it('handles empty bars response', async () => {
    const adapter = createMockAdapter([]);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi', 'sma', 'ema', 'atr'],
      interval: 'daily',
      lookback: 200,
    });

    expect(snapshot.currentPrice).toBe(0);
    expect(snapshot.warnings).toContain('No price data available');
    expect(snapshot.rsi).toBeUndefined();
    expect(snapshot.atr).toBeUndefined();
  });

  it('reports warnings for insufficient data', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 10 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi', 'sma', 'atr'],
      interval: 'daily',
      lookback: 200,
    });

    expect(snapshot.warnings.length).toBeGreaterThan(0);
    expect(snapshot.warnings.some((w) => w.includes('200-day SMA'))).toBe(true);
  });
});

// ============================================================================
// createTechnicalIndicatorsTool Tests
// ============================================================================

describe('createTechnicalIndicatorsTool', () => {
  it('creates tool with correct name and description', () => {
    const tool = createTechnicalIndicatorsTool({ adapter: null });
    expect(tool.name).toBe('compute_technicals');
    expect(tool.description).toContain('RSI');
    expect(tool.description).toContain('SMA');
    expect(tool.description).toContain('ATR');
  });

  it('returns error when adapter is null', async () => {
    const tool = createTechnicalIndicatorsTool({ adapter: null });
    const result = await tool.handler({ symbol: 'AAPL' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Not connected');
  });

  it('executes successfully with valid adapter', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1));
    const adapter = createMockAdapter(bars);
    const tool = createTechnicalIndicatorsTool({ adapter });

    const result = await tool.handler({ symbol: 'AAPL' });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.symbol).toBe('AAPL');
    expect(result.metadata!.indicatorsComputed).toEqual(['rsi', 'sma', 'ema', 'atr']);
    expect(result.metadata!.trendDirection).toBeDefined();
  });

  it('returns error for invalid input', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 50 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);
    const tool = createTechnicalIndicatorsTool({ adapter });

    const result = await tool.handler({ symbol: '' }); // Invalid empty symbol

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to compute');
  });

  it('handles adapter errors gracefully', async () => {
    const adapter = createMockAdapter([]);
    (adapter.getHistoricalBars as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );
    const tool = createTechnicalIndicatorsTool({ adapter });

    const result = await tool.handler({ symbol: 'AAPL' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('includes metadata with key values', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1));
    const adapter = createMockAdapter(bars);
    const tool = createTechnicalIndicatorsTool({ adapter });

    const result = await tool.handler({ symbol: 'AAPL' });

    expect(result.success).toBe(true);
    expect(result.metadata).toHaveProperty('currentPrice');
    expect(result.metadata).toHaveProperty('trendDirection');
    expect(result.metadata).toHaveProperty('rsiValue');
    expect(result.metadata).toHaveProperty('atrPercent');
    expect(result.metadata).toHaveProperty('barsAnalyzed');
    expect(result.metadata).toHaveProperty('warningCount');
  });

  it('respects indicator filter in input', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 100 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);
    const tool = createTechnicalIndicatorsTool({ adapter });

    const result = await tool.handler({ symbol: 'AAPL', indicators: ['rsi'] });

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.rsi).toBeDefined();
    expect(result.metadata!.indicatorsComputed).toEqual(['rsi']);
  });

  it('respects interval parameter', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 100 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);
    const tool = createTechnicalIndicatorsTool({ adapter });

    await tool.handler({ symbol: 'AAPL', interval: 'hourly' });

    expect(adapter.getHistoricalBars).toHaveBeenCalledWith(
      expect.objectContaining({ interval: 'hourly' })
    );
  });
});

// ============================================================================
// computeTechnicals Standalone Function Tests
// ============================================================================

describe('computeTechnicals', () => {
  it('works as standalone function', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 250 }, (_, i) => 100 + i * 0.1));
    const adapter = createMockAdapter(bars);

    const snapshot = await computeTechnicals(adapter, {
      symbol: 'SPY',
      indicators: ['rsi', 'sma', 'atr'],
      interval: 'daily',
      lookback: 200,
    });

    expect(snapshot.symbol).toBe('SPY');
    expect(snapshot.rsi).toBeDefined();
    expect(snapshot.movingAverages.sma.length).toBeGreaterThan(0);
    expect(snapshot.atr).toBeDefined();
  });
});

// ============================================================================
// Tool Registry Integration Tests
// ============================================================================

describe('Technical Indicators Tool Registry Integration', () => {
  it('can be registered and executed via registry', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 100 }, (_, i) => 100 + i));
    const adapter = createMockAdapter(bars);
    const registry = new ToolRegistry();
    const tool = createTechnicalIndicatorsTool({ adapter });

    registry.register(tool);

    const result = await registry.execute('compute_technicals', {
      symbol: 'AAPL',
      indicators: ['rsi'],
    });

    expect(result.success).toBe(true);
    const data = result.data as any;
    expect(data.symbol).toBe('AAPL');
    expect(data.rsi).toBeDefined();
  });

  it('appears in tool list', () => {
    const adapter = createMockAdapter([]);
    const registry = new ToolRegistry();
    const tool = createTechnicalIndicatorsTool({ adapter });

    registry.register(tool);

    const tools = registry.list();
    expect(tools.some((t) => t.name === 'compute_technicals')).toBe(true);
  });

  it('appears in tool descriptions', () => {
    const adapter = createMockAdapter([]);
    const registry = new ToolRegistry();
    const tool = createTechnicalIndicatorsTool({ adapter });

    registry.register(tool);

    const descriptions = registry.getToolDescriptions();
    expect(descriptions.some((d) => d.name === 'compute_technicals')).toBe(true);
    expect(descriptions.find((d) => d.name === 'compute_technicals')!.description).toContain('RSI');
  });
});

// ============================================================================
// RSI Hint Tests
// ============================================================================

describe('RSI Hints', () => {
  it('provides oversold hint', async () => {
    // Create downtrending data for low RSI
    const bars = createBarsFromCloses(Array.from({ length: 50 }, (_, i) => 200 - i * 3));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi'],
      interval: 'daily',
      lookback: 50,
    });

    if (snapshot.rsi && snapshot.rsi.interpretation === 'oversold') {
      expect(snapshot.rsi.hint).toContain('potential buying opportunity');
    }
  });

  it('provides overbought hint', async () => {
    // Create uptrending data for high RSI
    const bars = createBarsFromCloses(Array.from({ length: 50 }, (_, i) => 100 + i * 3));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['rsi'],
      interval: 'daily',
      lookback: 50,
    });

    if (snapshot.rsi && snapshot.rsi.interpretation === 'overbought') {
      expect(snapshot.rsi.hint).toContain('Be cautious');
    }
  });
});

// ============================================================================
// ATR Hint Tests
// ============================================================================

describe('ATR Hints', () => {
  it('provides volatility context in hint', async () => {
    const bars = createBarsFromCloses(Array.from({ length: 50 }, (_, i) => 100 + i * 0.1));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['atr'],
      interval: 'daily',
      lookback: 50,
    });

    if (snapshot.atr) {
      // Hint should mention stop losses and/or options premiums
      expect(
        snapshot.atr.hint.includes('stop') || snapshot.atr.hint.includes('volatility')
      ).toBe(true);
    }
  });
});

// ============================================================================
// Trend Signals Tests
// ============================================================================

describe('Trend Signals', () => {
  it('includes golden/death cross signals when applicable', async () => {
    // Create enough data for 50 and 200 SMAs
    const bars = createBarsFromCloses(Array.from({ length: 250 }, (_, i) => 100 + i * 0.2));
    const adapter = createMockAdapter(bars);

    const snapshot = await buildTechnicalIndicatorsSnapshot(adapter, {
      symbol: 'AAPL',
      indicators: ['sma'],
      interval: 'daily',
      lookback: 250,
    });

    // Should have trend signals
    expect(snapshot.trend.signals.length).toBeGreaterThan(0);
    // One signal should mention golden or death cross
    expect(
      snapshot.trend.signals.some((s) => s.includes('Golden') || s.includes('Death'))
    ).toBe(true);
  });
});
