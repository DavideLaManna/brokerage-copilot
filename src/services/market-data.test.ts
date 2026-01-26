/**
 * Market Data Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketDataService } from './market-data.js';
import type {
  BrokerAdapter,
  OptionChain,
  OptionChainRequest,
  Quote,
} from '../types/broker.js';

/**
 * Create a mock broker adapter for testing
 */
function createMockAdapter(): BrokerAdapter {
  return {
    brokerType: 'tradier',
    brokerName: 'Tradier',
    getAccountSummary: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    validateConnection: vi.fn(),
    disconnect: vi.fn(),
  };
}

/**
 * Create a mock option chain for testing
 */
function createMockOptionChain(symbol: string): OptionChain {
  const contracts = new Map<string, []>();
  contracts.set('2024-03-15', []);
  return {
    underlying: symbol,
    underlyingPrice: 150.0,
    expirations: [new Date('2024-03-15')],
    contracts,
    asOf: new Date(),
  };
}

/**
 * Create a mock quote for testing
 */
function createMockQuote(symbol: string): Quote {
  return {
    symbol,
    bid: 149.5,
    ask: 150.5,
    mid: 150.0,
    last: 150.0,
    bidSize: 100,
    askSize: 100,
    volume: 1000000,
    asOf: new Date(),
  };
}

describe('MarketDataService', () => {
  let adapter: BrokerAdapter;
  let service: MarketDataService;

  beforeEach(() => {
    adapter = createMockAdapter();
    service = new MarketDataService(adapter);
  });

  describe('getOptionChain', () => {
    it('fetches option chain from adapter on first request', async () => {
      const mockChain = createMockOptionChain('AAPL');
      (adapter.getOptionChain as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockChain
      );

      const request: OptionChainRequest = { symbol: 'AAPL', minDTE: 0, maxDTE: 45 };
      const result = await service.getOptionChain(request);

      expect(result).toEqual(mockChain);
      expect(adapter.getOptionChain).toHaveBeenCalledTimes(1);
      expect(adapter.getOptionChain).toHaveBeenCalledWith(request);
    });

    it('returns cached option chain on subsequent requests', async () => {
      const mockChain = createMockOptionChain('AAPL');
      (adapter.getOptionChain as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockChain
      );

      const request: OptionChainRequest = { symbol: 'AAPL', minDTE: 0, maxDTE: 45 };

      // First request - should hit adapter
      await service.getOptionChain(request);
      // Second request - should return cached
      const result = await service.getOptionChain(request);

      expect(result).toEqual(mockChain);
      expect(adapter.getOptionChain).toHaveBeenCalledTimes(1);
    });

    it('fetches fresh data when forceRefresh is true', async () => {
      const mockChain = createMockOptionChain('AAPL');
      (adapter.getOptionChain as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockChain
      );

      const request: OptionChainRequest = { symbol: 'AAPL' };

      // First request
      await service.getOptionChain(request);
      // Second request with force refresh
      await service.getOptionChain(request, true);

      expect(adapter.getOptionChain).toHaveBeenCalledTimes(2);
    });

    it('fetches fresh data when cache expires', async () => {
      const mockChain = createMockOptionChain('AAPL');
      (adapter.getOptionChain as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockChain
      );

      // Create service with very short TTL
      const shortTtlService = new MarketDataService(adapter, {
        optionChainTtlMs: 1, // 1ms TTL
      });

      const request: OptionChainRequest = { symbol: 'AAPL' };

      // First request
      await shortTtlService.getOptionChain(request);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second request - should fetch again due to expiry
      await shortTtlService.getOptionChain(request);

      expect(adapter.getOptionChain).toHaveBeenCalledTimes(2);
    });

    it('caches different requests separately', async () => {
      const mockChainAAPL = createMockOptionChain('AAPL');
      const mockChainGOOG = createMockOptionChain('GOOG');

      (adapter.getOptionChain as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockChainAAPL)
        .mockResolvedValueOnce(mockChainGOOG);

      const requestAAPL: OptionChainRequest = { symbol: 'AAPL' };
      const requestGOOG: OptionChainRequest = { symbol: 'GOOG' };

      const resultAAPL = await service.getOptionChain(requestAAPL);
      const resultGOOG = await service.getOptionChain(requestGOOG);

      expect(resultAAPL.underlying).toBe('AAPL');
      expect(resultGOOG.underlying).toBe('GOOG');
      expect(adapter.getOptionChain).toHaveBeenCalledTimes(2);
    });

    it('caches requests with different DTE parameters separately', async () => {
      const mockChain1 = createMockOptionChain('AAPL');
      const mockChain2 = createMockOptionChain('AAPL');

      (adapter.getOptionChain as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockChain1)
        .mockResolvedValueOnce(mockChain2);

      const request1: OptionChainRequest = { symbol: 'AAPL', minDTE: 0, maxDTE: 30 };
      const request2: OptionChainRequest = { symbol: 'AAPL', minDTE: 30, maxDTE: 60 };

      await service.getOptionChain(request1);
      await service.getOptionChain(request2);

      expect(adapter.getOptionChain).toHaveBeenCalledTimes(2);
    });
  });

  describe('getQuote', () => {
    it('fetches quote from adapter on first request', async () => {
      const mockQuote = createMockQuote('AAPL');
      (adapter.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockQuote
      );

      const result = await service.getQuote('AAPL');

      expect(result).toEqual(mockQuote);
      expect(adapter.getQuote).toHaveBeenCalledTimes(1);
      expect(adapter.getQuote).toHaveBeenCalledWith('AAPL');
    });

    it('returns cached quote on subsequent requests', async () => {
      const mockQuote = createMockQuote('AAPL');
      (adapter.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockQuote
      );

      // First request - should hit adapter
      await service.getQuote('AAPL');
      // Second request - should return cached
      const result = await service.getQuote('AAPL');

      expect(result).toEqual(mockQuote);
      expect(adapter.getQuote).toHaveBeenCalledTimes(1);
    });

    it('fetches fresh data when forceRefresh is true', async () => {
      const mockQuote = createMockQuote('AAPL');
      (adapter.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockQuote
      );

      // First request
      await service.getQuote('AAPL');
      // Second request with force refresh
      await service.getQuote('AAPL', true);

      expect(adapter.getQuote).toHaveBeenCalledTimes(2);
    });
  });

  describe('getQuotes', () => {
    it('fetches multiple quotes and caches them', async () => {
      (adapter.getQuote as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createMockQuote('AAPL'))
        .mockResolvedValueOnce(createMockQuote('GOOG'))
        .mockResolvedValueOnce(createMockQuote('MSFT'));

      const results = await service.getQuotes(['AAPL', 'GOOG', 'MSFT']);

      expect(results.size).toBe(3);
      expect(results.get('AAPL')?.symbol).toBe('AAPL');
      expect(results.get('GOOG')?.symbol).toBe('GOOG');
      expect(results.get('MSFT')?.symbol).toBe('MSFT');
      expect(adapter.getQuote).toHaveBeenCalledTimes(3);
    });

    it('uses cache for already-cached quotes', async () => {
      (adapter.getQuote as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createMockQuote('AAPL'))
        .mockResolvedValueOnce(createMockQuote('GOOG'));

      // Pre-cache AAPL
      await service.getQuote('AAPL');

      // Request AAPL and GOOG - only GOOG should trigger fetch
      const results = await service.getQuotes(['AAPL', 'GOOG']);

      expect(results.size).toBe(2);
      expect(adapter.getQuote).toHaveBeenCalledTimes(2); // 1 for AAPL, 1 for GOOG
    });

    it('handles failed quotes gracefully', async () => {
      (adapter.getQuote as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(createMockQuote('AAPL'))
        .mockRejectedValueOnce(new Error('Symbol not found'));

      const results = await service.getQuotes(['AAPL', 'INVALID']);

      expect(results.size).toBe(1);
      expect(results.get('AAPL')?.symbol).toBe('AAPL');
      expect(results.has('INVALID')).toBe(false);
    });
  });

  describe('cache statistics', () => {
    it('tracks option chain cache hits and misses', async () => {
      const mockChain = createMockOptionChain('AAPL');
      (adapter.getOptionChain as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockChain
      );

      const request: OptionChainRequest = { symbol: 'AAPL' };

      // First request - miss
      await service.getOptionChain(request);
      // Second request - hit
      await service.getOptionChain(request);
      // Third request - hit
      await service.getOptionChain(request);

      const stats = service.getOptionChainCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(2);
      expect(stats.entries).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('tracks quote cache hits and misses', async () => {
      const mockQuote = createMockQuote('AAPL');
      (adapter.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockQuote
      );

      // First request - miss
      await service.getQuote('AAPL');
      // Second request - hit
      await service.getQuote('AAPL');

      const stats = service.getQuoteCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);
      expect(stats.entries).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });
  });

  describe('cache management', () => {
    it('clears all caches', async () => {
      const mockChain = createMockOptionChain('AAPL');
      const mockQuote = createMockQuote('AAPL');
      (adapter.getOptionChain as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockChain
      );
      (adapter.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockQuote
      );

      // Populate caches
      await service.getOptionChain({ symbol: 'AAPL' });
      await service.getQuote('AAPL');

      expect(service.getOptionChainCacheStats().entries).toBe(1);
      expect(service.getQuoteCacheStats().entries).toBe(1);

      // Clear all caches
      service.clearCache();

      expect(service.getOptionChainCacheStats().entries).toBe(0);
      expect(service.getQuoteCacheStats().entries).toBe(0);
    });

    it('clears option chain cache only', async () => {
      const mockChain = createMockOptionChain('AAPL');
      const mockQuote = createMockQuote('AAPL');
      (adapter.getOptionChain as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockChain
      );
      (adapter.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(
        mockQuote
      );

      // Populate caches
      await service.getOptionChain({ symbol: 'AAPL' });
      await service.getQuote('AAPL');

      // Clear option chain cache only
      service.clearOptionChainCache();

      expect(service.getOptionChainCacheStats().entries).toBe(0);
      expect(service.getQuoteCacheStats().entries).toBe(1);
    });

    it('invalidates symbol-specific cache entries', async () => {
      const mockChainAAPL = createMockOptionChain('AAPL');
      const mockChainGOOG = createMockOptionChain('GOOG');
      const mockQuoteAAPL = createMockQuote('AAPL');
      const mockQuoteGOOG = createMockQuote('GOOG');

      (adapter.getOptionChain as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockChainAAPL)
        .mockResolvedValueOnce(mockChainGOOG);
      (adapter.getQuote as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockQuoteAAPL)
        .mockResolvedValueOnce(mockQuoteGOOG);

      // Populate caches
      await service.getOptionChain({ symbol: 'AAPL' });
      await service.getOptionChain({ symbol: 'GOOG' });
      await service.getQuote('AAPL');
      await service.getQuote('GOOG');

      expect(service.getOptionChainCacheStats().entries).toBe(2);
      expect(service.getQuoteCacheStats().entries).toBe(2);

      // Invalidate AAPL only
      service.invalidateSymbol('AAPL');

      expect(service.getOptionChainCacheStats().entries).toBe(1);
      expect(service.getQuoteCacheStats().entries).toBe(1);
    });
  });

  describe('cache eviction', () => {
    it('evicts oldest entries when max size exceeded', async () => {
      // Create service with small max size
      const smallCacheService = new MarketDataService(adapter, {
        maxOptionChainEntries: 2,
      });

      const mockChain1 = createMockOptionChain('AAPL');
      const mockChain2 = createMockOptionChain('GOOG');
      const mockChain3 = createMockOptionChain('MSFT');

      (adapter.getOptionChain as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockChain1)
        .mockResolvedValueOnce(mockChain2)
        .mockResolvedValueOnce(mockChain3)
        .mockResolvedValueOnce(mockChain1); // For re-fetch after eviction

      // Add 3 entries (max is 2)
      await smallCacheService.getOptionChain({ symbol: 'AAPL' });
      await smallCacheService.getOptionChain({ symbol: 'GOOG' });
      await smallCacheService.getOptionChain({ symbol: 'MSFT' });

      // Should have evicted AAPL (oldest)
      expect(smallCacheService.getOptionChainCacheStats().entries).toBe(2);

      // Requesting AAPL again should require a new fetch
      await smallCacheService.getOptionChain({ symbol: 'AAPL' });
      expect(adapter.getOptionChain).toHaveBeenCalledTimes(4);
    });
  });

  describe('configuration', () => {
    it('uses default TTL values', () => {
      const config = service.getConfig();
      expect(config.optionChainTtlMs).toBe(10 * 60 * 1000); // 10 minutes
      expect(config.quoteTtlMs).toBe(60 * 1000); // 1 minute
    });

    it('allows custom TTL configuration', () => {
      const customService = new MarketDataService(adapter, {
        optionChainTtlMs: 5 * 60 * 1000, // 5 minutes
        quoteTtlMs: 30 * 1000, // 30 seconds
      });

      const config = customService.getConfig();
      expect(config.optionChainTtlMs).toBe(5 * 60 * 1000);
      expect(config.quoteTtlMs).toBe(30 * 1000);
    });

    it('allows updating configuration', () => {
      service.updateConfig({ optionChainTtlMs: 15 * 60 * 1000 });

      const config = service.getConfig();
      expect(config.optionChainTtlMs).toBe(15 * 60 * 1000);
      expect(config.quoteTtlMs).toBe(60 * 1000); // unchanged
    });

    it('exposes underlying adapter', () => {
      expect(service.getAdapter()).toBe(adapter);
    });
  });
});
