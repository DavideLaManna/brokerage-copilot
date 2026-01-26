/**
 * Market Data Service
 *
 * Provides market data operations with caching for improved performance.
 * Wraps BrokerAdapter to add:
 * - Option chain caching with configurable TTL (default 10 minutes)
 * - Quote caching with shorter TTL (default 1 minute)
 * - Cache statistics and management
 *
 * Caching is important because:
 * - Option chains can be large and expensive to fetch
 * - Broker APIs have rate limits (see src/types/rate-limits.ts)
 * - Market data doesn't change instantly during trading hours
 */

import type {
  BrokerAdapter,
  OptionChain,
  OptionChainRequest,
  Quote,
  HistoricalBarsRequest,
  HistoricalBarsResponse,
} from '../types/broker.js';

/**
 * Cache entry with timestamp and TTL tracking
 */
interface CacheEntry<T> {
  data: T;
  cachedAt: Date;
  expiresAt: Date;
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  hitRate: number;
}

/**
 * Market data service configuration
 */
export interface MarketDataServiceConfig {
  /** TTL for option chain cache in milliseconds (default: 10 minutes) */
  optionChainTtlMs?: number;
  /** TTL for quote cache in milliseconds (default: 1 minute) */
  quoteTtlMs?: number;
  /** TTL for historical bars cache in milliseconds (default: 5 minutes for intraday, 1 hour for daily) */
  historicalBarsTtlMs?: number;
  /** Maximum number of cached option chains (default: 100) */
  maxOptionChainEntries?: number;
  /** Maximum number of cached quotes (default: 500) */
  maxQuoteEntries?: number;
  /** Maximum number of cached historical bar responses (default: 200) */
  maxHistoricalBarsEntries?: number;
}

const DEFAULT_CONFIG: Required<MarketDataServiceConfig> = {
  optionChainTtlMs: 10 * 60 * 1000, // 10 minutes
  quoteTtlMs: 60 * 1000, // 1 minute
  historicalBarsTtlMs: 5 * 60 * 1000, // 5 minutes (for intraday; daily data uses longer TTL dynamically)
  maxOptionChainEntries: 100,
  maxQuoteEntries: 500,
  maxHistoricalBarsEntries: 200,
};

/**
 * Generate cache key for option chain request
 */
function getOptionChainCacheKey(request: OptionChainRequest): string {
  const parts = [
    request.symbol,
    request.minDTE?.toString() ?? '',
    request.maxDTE?.toString() ?? '',
    request.minStrike?.toString() ?? '',
    request.maxStrike?.toString() ?? '',
  ];
  return `chain:${parts.join(':')}`;
}

/**
 * Generate cache key for quote
 */
function getQuoteCacheKey(symbol: string): string {
  return `quote:${symbol}`;
}

/**
 * Generate cache key for historical bars request
 */
function getHistoricalBarsCacheKey(request: HistoricalBarsRequest): string {
  const parts = [
    request.symbol,
    request.interval,
    request.start?.toISOString() ?? '',
    request.end?.toISOString() ?? '',
    request.limit?.toString() ?? '',
  ];
  return `bars:${parts.join(':')}`;
}

/**
 * Market Data Service with caching
 *
 * Provides cached access to market data from a broker adapter.
 * Option chains are cached for 5-15 minutes (configurable) to reduce
 * API calls and improve response times.
 */
export class MarketDataService {
  private adapter: BrokerAdapter;
  private config: Required<MarketDataServiceConfig>;

  private optionChainCache: Map<string, CacheEntry<OptionChain>> = new Map();
  private quoteCache: Map<string, CacheEntry<Quote>> = new Map();
  private historicalBarsCache: Map<string, CacheEntry<HistoricalBarsResponse>> = new Map();

  private optionChainHits = 0;
  private optionChainMisses = 0;
  private quoteHits = 0;
  private quoteMisses = 0;
  private historicalBarsHits = 0;
  private historicalBarsMisses = 0;

  constructor(adapter: BrokerAdapter, config: MarketDataServiceConfig = {}) {
    this.adapter = adapter;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get option chain with caching
   *
   * @param request - Option chain request parameters
   * @param forceRefresh - If true, bypass cache and fetch fresh data
   * @returns Option chain data (potentially cached)
   */
  async getOptionChain(
    request: OptionChainRequest,
    forceRefresh = false
  ): Promise<OptionChain> {
    const cacheKey = getOptionChainCacheKey(request);

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.optionChainCache.get(cacheKey);
      if (cached && !this.isExpired(cached)) {
        this.optionChainHits++;
        return cached.data;
      }
    }

    // Cache miss or expired - fetch fresh data
    this.optionChainMisses++;
    const optionChain = await this.adapter.getOptionChain(request);

    // Store in cache
    const now = new Date();
    this.optionChainCache.set(cacheKey, {
      data: optionChain,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.config.optionChainTtlMs),
    });

    // Enforce max entries (LRU-style eviction)
    this.evictOldestIfNeeded(
      this.optionChainCache,
      this.config.maxOptionChainEntries
    );

    return optionChain;
  }

  /**
   * Get quote with caching
   *
   * @param symbol - Symbol to get quote for
   * @param forceRefresh - If true, bypass cache and fetch fresh data
   * @returns Quote data (potentially cached)
   */
  async getQuote(symbol: string, forceRefresh = false): Promise<Quote> {
    const cacheKey = getQuoteCacheKey(symbol);

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.quoteCache.get(cacheKey);
      if (cached && !this.isExpired(cached)) {
        this.quoteHits++;
        return cached.data;
      }
    }

    // Cache miss or expired - fetch fresh data
    this.quoteMisses++;
    const quote = await this.adapter.getQuote(symbol);

    // Store in cache
    const now = new Date();
    this.quoteCache.set(cacheKey, {
      data: quote,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.config.quoteTtlMs),
    });

    // Enforce max entries
    this.evictOldestIfNeeded(this.quoteCache, this.config.maxQuoteEntries);

    return quote;
  }

  /**
   * Get multiple quotes with caching
   *
   * @param symbols - Symbols to get quotes for
   * @param forceRefresh - If true, bypass cache for all symbols
   * @returns Map of symbol to quote
   */
  async getQuotes(
    symbols: string[],
    forceRefresh = false
  ): Promise<Map<string, Quote>> {
    const results = new Map<string, Quote>();
    const symbolsToFetch: string[] = [];

    // Check cache for each symbol
    for (const symbol of symbols) {
      if (!forceRefresh) {
        const cacheKey = getQuoteCacheKey(symbol);
        const cached = this.quoteCache.get(cacheKey);
        if (cached && !this.isExpired(cached)) {
          this.quoteHits++;
          results.set(symbol, cached.data);
          continue;
        }
      }
      symbolsToFetch.push(symbol);
    }

    // Fetch uncached quotes
    for (const symbol of symbolsToFetch) {
      try {
        const quote = await this.getQuote(symbol, true);
        results.set(symbol, quote);
      } catch {
        // Skip failed quotes
      }
    }

    return results;
  }

  /**
   * Get historical price bars with caching
   *
   * @param request - Historical bars request parameters
   * @param forceRefresh - If true, bypass cache and fetch fresh data
   * @returns Historical bars data (potentially cached)
   */
  async getHistoricalBars(
    request: HistoricalBarsRequest,
    forceRefresh = false
  ): Promise<HistoricalBarsResponse> {
    const cacheKey = getHistoricalBarsCacheKey(request);

    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = this.historicalBarsCache.get(cacheKey);
      if (cached && !this.isExpired(cached)) {
        this.historicalBarsHits++;
        return cached.data;
      }
    }

    // Cache miss or expired - fetch fresh data
    this.historicalBarsMisses++;
    const barsResponse = await this.adapter.getHistoricalBars(request);

    // Calculate TTL based on interval type
    // Daily/weekly/monthly data changes less frequently, use longer TTL
    const isIntraday = ['minute', '5min', '15min', 'hourly'].includes(request.interval);
    const ttlMs = isIntraday
      ? this.config.historicalBarsTtlMs
      : Math.max(this.config.historicalBarsTtlMs, 60 * 60 * 1000); // At least 1 hour for daily+

    // Store in cache
    const now = new Date();
    this.historicalBarsCache.set(cacheKey, {
      data: barsResponse,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
    });

    // Enforce max entries (LRU-style eviction)
    this.evictOldestIfNeeded(
      this.historicalBarsCache,
      this.config.maxHistoricalBarsEntries
    );

    return barsResponse;
  }

  /**
   * Get option chain cache statistics
   */
  getOptionChainCacheStats(): CacheStats {
    const total = this.optionChainHits + this.optionChainMisses;
    return {
      hits: this.optionChainHits,
      misses: this.optionChainMisses,
      entries: this.optionChainCache.size,
      hitRate: total > 0 ? this.optionChainHits / total : 0,
    };
  }

  /**
   * Get quote cache statistics
   */
  getQuoteCacheStats(): CacheStats {
    const total = this.quoteHits + this.quoteMisses;
    return {
      hits: this.quoteHits,
      misses: this.quoteMisses,
      entries: this.quoteCache.size,
      hitRate: total > 0 ? this.quoteHits / total : 0,
    };
  }

  /**
   * Get historical bars cache statistics
   */
  getHistoricalBarsCacheStats(): CacheStats {
    const total = this.historicalBarsHits + this.historicalBarsMisses;
    return {
      hits: this.historicalBarsHits,
      misses: this.historicalBarsMisses,
      entries: this.historicalBarsCache.size,
      hitRate: total > 0 ? this.historicalBarsHits / total : 0,
    };
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.optionChainCache.clear();
    this.quoteCache.clear();
    this.historicalBarsCache.clear();
  }

  /**
   * Clear only option chain cache
   */
  clearOptionChainCache(): void {
    this.optionChainCache.clear();
  }

  /**
   * Clear only quote cache
   */
  clearQuoteCache(): void {
    this.quoteCache.clear();
  }

  /**
   * Clear only historical bars cache
   */
  clearHistoricalBarsCache(): void {
    this.historicalBarsCache.clear();
  }

  /**
   * Invalidate cache for a specific symbol
   *
   * @param symbol - Symbol to invalidate (removes all related cache entries)
   */
  invalidateSymbol(symbol: string): void {
    // Remove quote
    this.quoteCache.delete(getQuoteCacheKey(symbol));

    // Remove any option chain entries for this symbol
    for (const key of this.optionChainCache.keys()) {
      if (key.startsWith(`chain:${symbol}:`)) {
        this.optionChainCache.delete(key);
      }
    }

    // Remove any historical bars entries for this symbol
    for (const key of this.historicalBarsCache.keys()) {
      if (key.startsWith(`bars:${symbol}:`)) {
        this.historicalBarsCache.delete(key);
      }
    }
  }

  /**
   * Get the underlying broker adapter
   * Useful for operations that don't need caching
   */
  getAdapter(): BrokerAdapter {
    return this.adapter;
  }

  /**
   * Get current cache configuration
   */
  getConfig(): Readonly<Required<MarketDataServiceConfig>> {
    return { ...this.config };
  }

  /**
   * Update cache TTL settings
   * Does not affect already-cached entries
   */
  updateConfig(config: Partial<MarketDataServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // -------------------------------------------------------------------------
  // Private Helper Methods
  // -------------------------------------------------------------------------

  /**
   * Check if a cache entry has expired
   */
  private isExpired<T>(entry: CacheEntry<T>): boolean {
    return new Date() >= entry.expiresAt;
  }

  /**
   * Evict oldest entries if cache exceeds max size
   * Simple LRU-style eviction based on cachedAt timestamp
   */
  private evictOldestIfNeeded<T>(
    cache: Map<string, CacheEntry<T>>,
    maxEntries: number
  ): void {
    if (cache.size <= maxEntries) {
      return;
    }

    // Find entries to evict (oldest first)
    const entries = Array.from(cache.entries()).sort(
      (a, b) => a[1].cachedAt.getTime() - b[1].cachedAt.getTime()
    );

    const toEvict = cache.size - maxEntries;
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        cache.delete(entry[0]);
      }
    }
  }
}

/**
 * Create a MarketDataService wrapping a broker adapter
 *
 * @param adapter - Broker adapter to wrap
 * @param config - Optional cache configuration
 * @returns Configured MarketDataService
 */
export function createMarketDataService(
  adapter: BrokerAdapter,
  config?: MarketDataServiceConfig
): MarketDataService {
  return new MarketDataService(adapter, config);
}
