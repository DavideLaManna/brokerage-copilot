/**
 * Token Refresh Logic for OAuth Providers
 *
 * Handles automatic token refresh for OAuth-based broker integrations.
 */

import type { BrokerType } from '../types/broker.js';

/**
 * OAuth token data structure
 */
export interface OAuthTokens {
  /** Access token for API calls */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Token expiration timestamp (Unix ms) */
  expiresAt?: number;
  /** Token type (usually 'Bearer') */
  tokenType?: string;
  /** Scope of the token */
  scope?: string;
}

/**
 * Token refresh result
 */
export interface TokenRefreshResult {
  success: boolean;
  tokens?: OAuthTokens;
  error?: string;
}

/**
 * Token refresh handler function type
 */
export type TokenRefreshHandler = (
  refreshToken: string,
  brokerType: BrokerType
) => Promise<TokenRefreshResult>;

/**
 * Default refresh buffer time (5 minutes before expiry)
 */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Check if a token needs to be refreshed
 *
 * @param expiresAt - Token expiration timestamp in milliseconds
 * @param bufferMs - Buffer time before expiration to trigger refresh
 * @returns true if token should be refreshed
 */
export function shouldRefreshToken(
  expiresAt: number | undefined,
  bufferMs: number = REFRESH_BUFFER_MS
): boolean {
  if (!expiresAt) {
    // No expiration info, assume token is still valid
    return false;
  }

  const now = Date.now();
  return now >= expiresAt - bufferMs;
}

/**
 * Calculate token expiration timestamp from expires_in seconds
 *
 * @param expiresIn - Token lifetime in seconds
 * @returns Expiration timestamp in milliseconds
 */
export function calculateExpiresAt(expiresIn: number): number {
  return Date.now() + expiresIn * 1000;
}

/**
 * Token refresh registry for different brokers
 */
const refreshHandlers = new Map<BrokerType, TokenRefreshHandler>();

/**
 * Register a token refresh handler for a broker
 */
export function registerTokenRefreshHandler(
  brokerType: BrokerType,
  handler: TokenRefreshHandler
): void {
  refreshHandlers.set(brokerType, handler);
}

/**
 * Get the token refresh handler for a broker
 */
export function getTokenRefreshHandler(
  brokerType: BrokerType
): TokenRefreshHandler | undefined {
  return refreshHandlers.get(brokerType);
}

/**
 * Check if a broker supports token refresh
 */
export function supportsTokenRefresh(brokerType: BrokerType): boolean {
  return refreshHandlers.has(brokerType);
}

/**
 * Refresh tokens for a broker
 *
 * @param brokerType - The broker to refresh tokens for
 * @param refreshToken - The refresh token to use
 * @returns Refresh result with new tokens or error
 */
export async function refreshTokens(
  brokerType: BrokerType,
  refreshToken: string
): Promise<TokenRefreshResult> {
  const handler = refreshHandlers.get(brokerType);

  if (!handler) {
    return {
      success: false,
      error: `No token refresh handler registered for broker: ${brokerType}`,
    };
  }

  try {
    return await handler(refreshToken, brokerType);
  } catch (error) {
    return {
      success: false,
      error: `Token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Broker-specific OAuth configuration
 */
export interface OAuthConfig {
  /** OAuth authorization URL */
  authorizationUrl: string;
  /** OAuth token URL */
  tokenUrl: string;
  /** Required scopes */
  scopes: string[];
  /** Whether refresh tokens are supported */
  supportsRefresh: boolean;
}

/**
 * OAuth configurations for supported brokers
 */
export const OAUTH_CONFIGS: Partial<Record<BrokerType, OAuthConfig>> = {
  tradier: {
    authorizationUrl: 'https://api.tradier.com/v1/oauth/authorize',
    tokenUrl: 'https://api.tradier.com/v1/oauth/accesstoken',
    scopes: ['read', 'write', 'market', 'trade'],
    supportsRefresh: true,
  },
  // Alpaca uses API keys, not OAuth
  // tastytrade uses username/password, not OAuth
  // IBKR uses TWS/Gateway, not OAuth
};

/**
 * Get OAuth configuration for a broker
 */
export function getOAuthConfig(brokerType: BrokerType): OAuthConfig | undefined {
  return OAUTH_CONFIGS[brokerType];
}

/**
 * Check if a broker uses OAuth authentication
 */
export function usesOAuth(brokerType: BrokerType): boolean {
  return brokerType in OAUTH_CONFIGS;
}
