/**
 * Rate Limit Configuration
 *
 * Documents expected rate limits for supported brokers and provides
 * configuration for rate limiting middleware.
 *
 * Rate Limit Summary by Broker:
 * -----------------------------
 * | Broker    | Requests/Min | Requests/Day | Notes                          |
 * |-----------|--------------|--------------|--------------------------------|
 * | Alpaca    | 200          | None         | Per API key, paper = separate  |
 * | Tradier   | 120          | None         | Per access token               |
 * | tastytrade| 60           | None         | Conservative estimate          |
 * | IBKR      | 50           | None         | TWS API, varies by endpoint    |
 */

import type { BrokerType } from './broker.js';

/**
 * Rate limit configuration for a broker
 */
export interface RateLimitConfig {
  /** Broker identifier */
  brokerType: BrokerType;

  /** Maximum requests per minute */
  requestsPerMinute: number;

  /** Maximum requests per second (derived from per-minute) */
  requestsPerSecond: number;

  /** Daily request limit (null if unlimited) */
  dailyLimit: number | null;

  /** Burst limit (max requests in short burst) */
  burstLimit: number;

  /** Minimum delay between requests in milliseconds */
  minDelayMs: number;

  /** Whether rate limits are per-endpoint or global */
  perEndpoint: boolean;

  /** Endpoint-specific overrides */
  endpointOverrides?: {
    [endpoint: string]: {
      requestsPerMinute: number;
      minDelayMs: number;
    };
  };
}

/**
 * Default rate limit configurations by broker
 */
export const RATE_LIMIT_CONFIGS: Record<BrokerType, RateLimitConfig> = {
  alpaca: {
    brokerType: 'alpaca',
    requestsPerMinute: 200,
    requestsPerSecond: 3.33,
    dailyLimit: null,
    burstLimit: 10,
    minDelayMs: 300,
    perEndpoint: false,
    endpointOverrides: {
      // Data API has different limits
      '/v2/stocks/quotes': {
        requestsPerMinute: 200,
        minDelayMs: 300,
      },
      '/v1/options/snapshots': {
        requestsPerMinute: 100,
        minDelayMs: 600,
      },
    },
  },

  tradier: {
    brokerType: 'tradier',
    requestsPerMinute: 120,
    requestsPerSecond: 2,
    dailyLimit: null,
    burstLimit: 5,
    minDelayMs: 500,
    perEndpoint: false,
    endpointOverrides: {
      // Market data endpoints
      '/v1/markets/quotes': {
        requestsPerMinute: 60,
        minDelayMs: 1000,
      },
      '/v1/markets/options/chains': {
        requestsPerMinute: 30,
        minDelayMs: 2000,
      },
    },
  },

  tastytrade: {
    brokerType: 'tastytrade',
    requestsPerMinute: 60,
    requestsPerSecond: 1,
    dailyLimit: null,
    burstLimit: 3,
    minDelayMs: 1000,
    perEndpoint: false,
  },

  ibkr: {
    brokerType: 'ibkr',
    requestsPerMinute: 50,
    requestsPerSecond: 0.83,
    dailyLimit: null,
    burstLimit: 5,
    minDelayMs: 1200,
    perEndpoint: true,
    endpointOverrides: {
      // Historical data is heavily rate limited
      historicalData: {
        requestsPerMinute: 10,
        minDelayMs: 6000,
      },
      // Market data subscriptions
      marketData: {
        requestsPerMinute: 100,
        minDelayMs: 600,
      },
    },
  },
};

/**
 * Get rate limit configuration for a broker
 */
export function getRateLimitConfig(brokerType: BrokerType): RateLimitConfig {
  const config = RATE_LIMIT_CONFIGS[brokerType];
  if (!config) {
    throw new Error(`Unknown broker type: ${brokerType}`);
  }
  return config;
}

/**
 * Calculate recommended delay between requests
 * @param brokerType - Broker identifier
 * @param currentLoad - Current request count in window (0-1 ratio)
 * @returns Recommended delay in milliseconds
 */
export function calculateRequestDelay(
  brokerType: BrokerType,
  currentLoad: number
): number {
  const config = getRateLimitConfig(brokerType);

  // Base delay
  let delay = config.minDelayMs;

  // Increase delay as we approach rate limit
  if (currentLoad > 0.8) {
    delay *= 2;
  } else if (currentLoad > 0.5) {
    delay *= 1.5;
  }

  return Math.ceil(delay);
}

/**
 * Rate limiter state for tracking request counts
 */
export interface RateLimiterState {
  /** Current window start timestamp */
  windowStart: number;
  /** Request count in current window */
  requestCount: number;
  /** Daily request count (if applicable) */
  dailyCount: number;
  /** Daily window start timestamp */
  dailyWindowStart: number;
}

/**
 * Create initial rate limiter state
 */
export function createRateLimiterState(): RateLimiterState {
  const now = Date.now();
  return {
    windowStart: now,
    requestCount: 0,
    dailyCount: 0,
    dailyWindowStart: now,
  };
}
