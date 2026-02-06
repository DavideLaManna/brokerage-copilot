/**
 * Tests for Candidate Scanner Service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { BrokerAdapter, AccountSummary, Position, Quote, OptionChain, HistoricalBarsResponse } from '../types/broker.js';
import type { MarketDataService } from './market-data.js';
import {
  CandidateScannerService,
  createCandidateScannerService,
  evaluateSymbolForCandidates,
} from './candidate-scanner.js';
import {
  DEFAULT_SCANNER_CONFIG,
  DEFAULT_SCANNER_FILTERS,
  type CandidateScannerConfig,
} from '../types/candidate-scanner.js';

// ============================================================================
// Mock Data
// ============================================================================

function createMockQuote(symbol: string, last: number): Quote {
  return {
    symbol,
    bid: last - 0.01,
    ask: last + 0.01,
    last,
    change: 0.5,
    changePercent: 0.33,
    volume: 1000000,
    open: last - 0.5,
    high: last + 1,
    low: last - 1,
    previousClose: last - 0.5,
    timestamp: new Date(),
  };
}

function createMockHistoricalBars(symbol: string, count: number = 250): HistoricalBarsResponse {
  const bars = [];
  const now = new Date();
  let close = 150;

  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const change = (Math.random() - 0.5) * 2;
    close += change;
    bars.push({
      timestamp: date,
      open: close - Math.random(),
      high: close + Math.random() * 2,
      low: close - Math.random() * 2,
      close: close,
      volume: Math.floor(Math.random() * 10000000),
    });
  }

  return {
    symbol,
    bars,
    interval: 'daily',
    startDate: new Date(now.getTime() - count * 24 * 60 * 60 * 1000),
    endDate: now,
  };
}

function createMockOptionChain(symbol: string): OptionChain {
  const currentPrice = 150;
  const contracts = [];

  // Create a simple option chain
  for (let strike = currentPrice - 10; strike <= currentPrice + 10; strike += 5) {
    for (const optionType of ['call', 'put'] as const) {
      contracts.push({
        optionSymbol: `${symbol}${strike}${optionType[0].toUpperCase()}`,
        underlying: symbol,
        strike,
        expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        optionType,
        bid: 2.0,
        ask: 2.10,
        last: 2.05,
        volume: 500,
        openInterest: 5000,
        impliedVolatility: 0.30,
        multiplier: 100,
        greeks: {
          delta: optionType === 'call' ? 0.5 : -0.5,
          gamma: 0.05,
          theta: -0.05,
          vega: 0.1,
          rho: 0.01,
        },
      });
    }
  }

  return {
    symbol,
    expirations: [new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)],
    contracts,
  };
}

function createMockAdapter(): BrokerAdapter {
  return {
    getAccountSummary: vi.fn().mockResolvedValue({
      accountId: 'test-account',
      buyingPower: 100000,
      netLiquidation: 100000,
      totalPositionValue: 0,
      cashBalance: 100000,
      unrealizedPnL: 0,
      realizedPnL: 0,
      dailyPnL: 0,
    }),
    getPositions: vi.fn().mockResolvedValue([]),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOrder: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getQuote: vi.fn().mockImplementation((symbol: string) =>
      Promise.resolve(createMockQuote(symbol, 150))
    ),
    getOptionChain: vi.fn().mockImplementation((symbol: string) =>
      Promise.resolve(createMockOptionChain(symbol))
    ),
    getHistoricalBars: vi.fn().mockImplementation((symbol: string) =>
      Promise.resolve(createMockHistoricalBars(symbol))
    ),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  };
}

function createMockMarketDataService(adapter: BrokerAdapter): MarketDataService {
  return {
    getQuote: vi.fn().mockImplementation((symbol: string) =>
      Promise.resolve(createMockQuote(symbol, 150))
    ),
    getOptionChain: vi.fn().mockImplementation((request: any) =>
      Promise.resolve(createMockOptionChain(request.symbol))
    ),
    getHistoricalBars: vi.fn().mockImplementation((request: any) =>
      Promise.resolve(createMockHistoricalBars(request.symbol))
    ),
    invalidateSymbol: vi.fn(),
    clearCache: vi.fn(),
    getQuoteCacheStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0, hitRate: 0 }),
    getOptionChainCacheStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0, hitRate: 0 }),
    getHistoricalBarsCacheStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0, hitRate: 0 }),
  } as unknown as MarketDataService;
}

// ============================================================================
// Tests
// ============================================================================

describe('CandidateScannerService', () => {
  let adapter: BrokerAdapter;
  let marketDataService: MarketDataService;
  let service: CandidateScannerService;

  beforeEach(() => {
    adapter = createMockAdapter();
    marketDataService = createMockMarketDataService(adapter);
    service = createCandidateScannerService(adapter, marketDataService, {
      accountId: 'test-account',
      config: {
        ...DEFAULT_SCANNER_CONFIG,
        symbolsToScan: ['AAPL', 'MSFT'],
      },
    });
  });

  afterEach(() => {
    service.stopPolling();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create service with default config', () => {
      const config = service.getConfig();
      expect(config.pollingIntervalMs).toBe(DEFAULT_SCANNER_CONFIG.pollingIntervalMs);
      expect(config.maxCandidatesPerScan).toBe(DEFAULT_SCANNER_CONFIG.maxCandidatesPerScan);
    });

    it('should accept custom config', () => {
      const customService = createCandidateScannerService(adapter, marketDataService, {
        accountId: 'test',
        config: {
          pollingIntervalMs: 60000,
          maxCandidatesPerScan: 10,
        },
      });
      const config = customService.getConfig();
      expect(config.pollingIntervalMs).toBe(60000);
      expect(config.maxCandidatesPerScan).toBe(10);
    });
  });

  describe('configuration', () => {
    it('should update config', () => {
      service.updateConfig({
        maxCandidatesPerScan: 30,
        minScore: 60,
      });

      const config = service.getConfig();
      expect(config.maxCandidatesPerScan).toBe(30);
      expect(config.minScore).toBe(60);
    });

    it('should merge filter updates', () => {
      service.updateConfig({
        filters: {
          minDTE: 21,
        },
      });

      const config = service.getConfig();
      expect(config.filters.minDTE).toBe(21);
      // Other filters should remain
      expect(config.filters.rsiOversold?.enabled).toBe(true);
    });
  });

  describe('polling', () => {
    it('should start and stop polling', () => {
      expect(service.isPollingActive()).toBe(false);

      service.startPolling();
      expect(service.isPollingActive()).toBe(true);

      service.stopPolling();
      expect(service.isPollingActive()).toBe(false);
    });

    it('should not start polling twice', () => {
      service.startPolling();
      service.startPolling(); // Should not error
      expect(service.isPollingActive()).toBe(true);
    });
  });

  describe('scanning', () => {
    it('should return empty result when no symbols configured', async () => {
      const emptyService = createCandidateScannerService(adapter, marketDataService, {
        accountId: 'test',
        config: { symbolsToScan: [] },
      });

      const result = await emptyService.scan();
      expect(result.candidates).toHaveLength(0);
      expect(result.warnings).toContain('No symbols configured for scanning');
    });

    it('should scan configured symbols', async () => {
      const result = await service.scan();

      expect(result.scannedSymbols).toContain('AAPL');
      expect(result.scannedSymbols).toContain('MSFT');
      expect(result.symbolsEvaluated).toBeGreaterThan(0);
    });

    it('should scan specific symbols when provided', async () => {
      const result = await service.scan(['GOOGL']);

      expect(result.scannedSymbols).toContain('GOOGL');
      expect(result.scannedSymbols).not.toContain('AAPL');
    });

    it('should include duration in result', async () => {
      const result = await service.scan();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should skip symbols with errors', async () => {
      // Make one symbol fail
      (marketDataService.getHistoricalBars as any).mockImplementation((request: any) => {
        if (request.symbol === 'AAPL') {
          return Promise.reject(new Error('Test error'));
        }
        return Promise.resolve(createMockHistoricalBars(request.symbol));
      });

      const result = await service.scan();

      expect(result.skipped.some((s) => s.symbol === 'AAPL')).toBe(true);
    });
  });

  describe('candidate management', () => {
    it('should store candidates after scan', async () => {
      await service.scan();

      const candidates = service.getAllCandidates();
      // May or may not have candidates depending on triggers
      expect(Array.isArray(candidates)).toBe(true);
    });

    it('should query candidates with filters', async () => {
      await service.scan();

      const result = service.queryCandidates({
        status: ['new'],
        sortBy: 'score',
        sortOrder: 'desc',
        limit: 5,
      });

      expect(result.candidates).toBeDefined();
      expect(result.totalCount).toBeDefined();
      expect(result.hasMore).toBeDefined();
    });

    it('should mark candidate as viewed', async () => {
      await service.scan();
      const candidates = service.getAllCandidates();

      if (candidates.length > 0) {
        const updated = await service.markAsViewed(candidates[0]!.id);
        expect(updated?.status).toBe('viewed');
        expect(updated?.viewedAt).toBeDefined();
      }
    });

    it('should dismiss candidate', async () => {
      await service.scan();
      const candidates = service.getAllCandidates();

      if (candidates.length > 0) {
        const updated = await service.dismissCandidate(candidates[0]!.id, 'Not interested');
        expect(updated?.status).toBe('dismissed');
        expect(updated?.dismissReason).toBe('Not interested');
      }
    });

    it('should mark candidate as actioned', async () => {
      await service.scan();
      const candidates = service.getAllCandidates();

      if (candidates.length > 0) {
        const updated = await service.markAsActioned(candidates[0]!.id);
        expect(updated?.status).toBe('actioned');
        expect(updated?.actionedAt).toBeDefined();
      }
    });

    it('should delete candidate', async () => {
      await service.scan();
      const candidates = service.getAllCandidates();

      if (candidates.length > 0) {
        const deleted = await service.deleteCandidate(candidates[0]!.id);
        expect(deleted).toBe(true);

        const found = service.getCandidate(candidates[0]!.id);
        expect(found).toBeUndefined();
      }
    });

    it('should clear all candidates', async () => {
      await service.scan();
      await service.clearCandidates();

      const candidates = service.getAllCandidates();
      expect(candidates).toHaveLength(0);
    });
  });

  describe('statistics', () => {
    it('should return statistics', async () => {
      await service.scan();

      const stats = service.getStatistics();
      expect(stats.totalCandidates).toBeDefined();
      expect(stats.byStatus).toBeDefined();
      expect(stats.byStrategy).toBeDefined();
      expect(stats.averageScore).toBeDefined();
      expect(stats.lastScanAt).toBeDefined();
    });
  });
});

describe('evaluateSymbolForCandidates', () => {
  let adapter: BrokerAdapter;
  let marketDataService: MarketDataService;

  beforeEach(() => {
    adapter = createMockAdapter();
    marketDataService = createMockMarketDataService(adapter);
  });

  it('should evaluate a symbol and return triggers', async () => {
    const triggers = await evaluateSymbolForCandidates('AAPL', marketDataService);
    expect(Array.isArray(triggers)).toBe(true);
  });

  it('should return empty triggers for insufficient data', async () => {
    (marketDataService.getHistoricalBars as any).mockResolvedValue({
      symbol: 'TEST',
      bars: [],
      interval: 'daily',
      startDate: new Date(),
      endDate: new Date(),
    });

    const triggers = await evaluateSymbolForCandidates('TEST', marketDataService);
    expect(triggers).toHaveLength(0);
  });
});

describe('createCandidateScannerService', () => {
  it('should create service with factory function', () => {
    const adapter = createMockAdapter();
    const marketDataService = createMockMarketDataService(adapter);

    const service = createCandidateScannerService(adapter, marketDataService, {
      accountId: 'test',
    });

    expect(service).toBeInstanceOf(CandidateScannerService);
  });

  it('should pass options to service', () => {
    const adapter = createMockAdapter();
    const marketDataService = createMockMarketDataService(adapter);

    const service = createCandidateScannerService(adapter, marketDataService, {
      accountId: 'custom-account',
      config: {
        maxCandidatesPerScan: 5,
      },
    });

    const config = service.getConfig();
    expect(config.maxCandidatesPerScan).toBe(5);
  });
});
