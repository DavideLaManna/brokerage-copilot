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
  /** Maximum number of cached option chains (default: 100) */
  maxOptionChainEntries?: number;
  /** Maximum number of cached quotes (default: 500) */
  maxQuoteEntries?: number;
}

const DEFAULT_CONFIG: Required<MarketDataServiceConfig> = {
  optionChainTtlMs: 10 * 60 * 1000, // 10 minutes
  quoteTtlMs: 60 * 1000, // 1 minute
  maxOptionChainEntries: 100,
  maxQuoteEntries: 500,
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

  private optionChainHits = 0;
  private optionChainMisses = 0;
  private quoteHits = 0;
  private quoteMisses = 0;

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
   * Clear all caches
   */
  clearCache(): void {
    this.optionChainCache.clear();
    this.quoteCache.clear();
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
