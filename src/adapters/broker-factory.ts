/**
 * Broker Adapter Factory
 *
 * Factory pattern for creating broker adapter instances.
 * Supports runtime broker selection based on configuration.
 */

import type {
  BrokerAdapter,
  BrokerType,
} from '../types/broker.js';
import { BrokerError, BrokerErrorCode } from '../types/errors.js';

/**
 * Configuration required to create a broker adapter
 */
export interface BrokerConfig {
  /** Type of broker to connect to */
  brokerType: BrokerType;

  /** API key or client ID */
  apiKey?: string;

  /** API secret or client secret */
  apiSecret?: string;

  /** OAuth access token (for OAuth-based brokers) */
  accessToken?: string;

  /** OAuth refresh token */
  refreshToken?: string;

  /** Account ID (some brokers require explicit account selection) */
  accountId?: string;

  /** Whether to use sandbox/paper trading mode */
  sandbox?: boolean;

  /** Custom base URL (for testing or different environments) */
  baseUrl?: string;
}

/**
 * Type definition for adapter constructor functions
 */
export type BrokerAdapterConstructor = (config: BrokerConfig) => Promise<BrokerAdapter>;

/**
 * Registry of adapter constructors by broker type
 */
const adapterRegistry = new Map<BrokerType, BrokerAdapterConstructor>();

/**
 * Register a broker adapter implementation
 *
 * @param brokerType - The broker type identifier
 * @param constructor - Factory function that creates the adapter
 *
 * @example
 * ```typescript
 * registerBrokerAdapter('alpaca', async (config) => {
 *   return new AlpacaAdapter(config);
 * });
 * ```
 */
export function registerBrokerAdapter(
  brokerType: BrokerType,
  constructor: BrokerAdapterConstructor
): void {
  adapterRegistry.set(brokerType, constructor);
}

/**
 * Check if a broker adapter is registered
 */
export function isAdapterRegistered(brokerType: BrokerType): boolean {
  return adapterRegistry.has(brokerType);
}

/**
 * Get list of registered broker types
 */
export function getRegisteredBrokers(): BrokerType[] {
  return Array.from(adapterRegistry.keys());
}

/**
 * Create a broker adapter instance
 *
 * @param config - Broker configuration including credentials
 * @returns Initialized and connected broker adapter
 * @throws BrokerError if broker type is not registered or initialization fails
 *
 * @example
 * ```typescript
 * const adapter = await createBrokerAdapter({
 *   brokerType: 'alpaca',
 *   apiKey: process.env.ALPACA_API_KEY,
 *   apiSecret: process.env.ALPACA_API_SECRET,
 *   sandbox: true,
 * });
 *
 * const positions = await adapter.getPositions();
 * ```
 */
export async function createBrokerAdapter(
  config: BrokerConfig
): Promise<BrokerAdapter> {
  const constructor = adapterRegistry.get(config.brokerType);

  if (!constructor) {
    const registered = getRegisteredBrokers();
    throw new BrokerError(
      BrokerErrorCode.UNKNOWN_ERROR,
      `Broker adapter for '${config.brokerType}' is not registered. ` +
        `Available brokers: ${registered.length > 0 ? registered.join(', ') : 'none'}`,
      config.brokerType
    );
  }

  try {
    const adapter = await constructor(config);

    // Validate connection after creation
    const isValid = await adapter.validateConnection();
    if (!isValid) {
      throw new BrokerError(
        BrokerErrorCode.AUTHENTICATION_FAILED,
        'Failed to validate broker connection',
        config.brokerType
      );
    }

    return adapter;
  } catch (error) {
    if (error instanceof BrokerError) {
      throw error;
    }

    throw new BrokerError(
      BrokerErrorCode.CONNECTION_FAILED,
      `Failed to create broker adapter: ${error instanceof Error ? error.message : String(error)}`,
      config.brokerType,
      error
    );
  }
}

/**
 * Validate broker configuration has required fields
 */
export function validateBrokerConfig(config: BrokerConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.brokerType) {
    errors.push('brokerType is required');
  }

  // Broker-specific validation
  switch (config.brokerType) {
    case 'alpaca':
      if (!config.apiKey) errors.push('apiKey is required for Alpaca');
      if (!config.apiSecret) errors.push('apiSecret is required for Alpaca');
      break;

    case 'tradier':
      if (!config.accessToken) errors.push('accessToken is required for Tradier');
      break;

    case 'tastytrade':
      if (!config.apiKey) errors.push('apiKey (username) is required for tastytrade');
      if (!config.apiSecret) errors.push('apiSecret (password) is required for tastytrade');
      break;

    case 'ibkr':
      // IBKR uses TWS or Gateway connection, credentials handled differently
      if (!config.baseUrl) errors.push('baseUrl (TWS/Gateway URL) is required for IBKR');
      break;

    default:
      // Allow unknown broker types (they'll fail at adapter creation)
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get broker-specific environment variable names
 */
export function getBrokerEnvVars(brokerType: BrokerType): {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accountId: string;
  baseUrl: string;
} {
  const prefix = brokerType.toUpperCase();
  return {
    apiKey: `${prefix}_API_KEY`,
    apiSecret: `${prefix}_API_SECRET`,
    accessToken: `${prefix}_ACCESS_TOKEN`,
    accountId: `${prefix}_ACCOUNT_ID`,
    baseUrl: `${prefix}_BASE_URL`,
  };
}

/**
 * Create broker configuration from environment variables
 */
export function createConfigFromEnv(brokerType: BrokerType): BrokerConfig {
  const envVars = getBrokerEnvVars(brokerType);

  return {
    brokerType,
    apiKey: process.env[envVars.apiKey],
    apiSecret: process.env[envVars.apiSecret],
    accessToken: process.env[envVars.accessToken],
    accountId: process.env[envVars.accountId],
    baseUrl: process.env[envVars.baseUrl],
    sandbox: process.env.NODE_ENV !== 'production',
  };
}
