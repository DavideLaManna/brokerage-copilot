/**
 * Broker Connection Service
 *
 * High-level service for managing broker connections.
 * Integrates SecretManager for secure credential storage with BrokerAdapter factory.
 *
 * Features:
 * - Connect to broker using stored credentials
 * - Retrieve account summary (balance, buying power)
 * - Handle auth errors gracefully
 * - Disconnect functionality
 */

import type { BrokerAdapter, BrokerType, AccountSummary } from '../types/broker.js';
import { BrokerError, BrokerErrorCode, AuthenticationError } from '../types/errors.js';
import { createBrokerAdapter, type BrokerConfig } from '../adapters/broker-factory.js';
import { SecretManager, type BrokerCredentials } from '../storage/secrets.js';
import { maskSecret } from '../storage/encryption.js';

/**
 * Connection state for a broker
 */
export interface ConnectionState {
  brokerType: BrokerType;
  connected: boolean;
  lastConnected?: Date;
  lastError?: string;
  accountSummary?: AccountSummary;
}

/**
 * Connection result
 */
export interface ConnectionResult {
  success: boolean;
  brokerType: BrokerType;
  accountSummary?: AccountSummary;
  error?: string;
  errorCode?: BrokerErrorCode;
}

/**
 * Broker Connection Service
 *
 * Manages the lifecycle of broker connections with secure credential handling.
 */
export class BrokerConnectionService {
  private secretManager: SecretManager;
  private adapters: Map<BrokerType, BrokerAdapter> = new Map();
  private connectionStates: Map<BrokerType, ConnectionState> = new Map();

  constructor(secretManager: SecretManager) {
    this.secretManager = secretManager;
  }

  /**
   * Connect to a broker using stored credentials
   *
   * @param brokerType - The broker to connect to
   * @returns Connection result with account summary on success
   */
  async connect(brokerType: BrokerType): Promise<ConnectionResult> {
    // Check if already connected
    const existingAdapter = this.adapters.get(brokerType);
    if (existingAdapter) {
      try {
        // Validate existing connection is still valid
        const isValid = await existingAdapter.validateConnection();
        if (isValid) {
          const accountSummary = await existingAdapter.getAccountSummary();
          this.updateConnectionState(brokerType, true, accountSummary);
          return {
            success: true,
            brokerType,
            accountSummary,
          };
        }
      } catch {
        // Connection no longer valid, continue to reconnect
        await this.disconnect(brokerType);
      }
    }

    // Get credentials from SecretManager
    const credentials = await this.secretManager.getCredentials(brokerType, true);
    if (!credentials) {
      const error = `No credentials found for ${brokerType}. Please configure credentials first.`;
      this.updateConnectionState(brokerType, false, undefined, error);
      return {
        success: false,
        brokerType,
        error,
        errorCode: BrokerErrorCode.INVALID_CREDENTIALS,
      };
    }

    try {
      // Convert credentials to broker config
      const config = this.credentialsToBrokerConfig(credentials);

      // Create and validate adapter
      const adapter = await createBrokerAdapter(config);

      // Store the adapter
      this.adapters.set(brokerType, adapter);

      // Get account summary to verify connection and return useful data
      const accountSummary = await adapter.getAccountSummary();

      // Update connection state
      this.updateConnectionState(brokerType, true, accountSummary);

      // Log success (without exposing secrets)
      console.log(
        `Connected to ${brokerType} - Account: ${maskSecret(credentials.accountId ?? 'default')}`
      );

      return {
        success: true,
        brokerType,
        accountSummary,
      };
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      const errorCode = error instanceof BrokerError ? error.code : BrokerErrorCode.UNKNOWN_ERROR;

      this.updateConnectionState(brokerType, false, undefined, errorMessage);

      return {
        success: false,
        brokerType,
        error: errorMessage,
        errorCode,
      };
    }
  }

  /**
   * Disconnect from a broker
   *
   * @param brokerType - The broker to disconnect from
   * @returns true if disconnection was successful
   */
  async disconnect(brokerType: BrokerType): Promise<boolean> {
    const adapter = this.adapters.get(brokerType);
    if (!adapter) {
      return false;
    }

    try {
      await adapter.disconnect();
    } catch {
      // Ignore disconnect errors
    }

    this.adapters.delete(brokerType);
    this.updateConnectionState(brokerType, false);

    console.log(`Disconnected from ${brokerType}`);
    return true;
  }

  /**
   * Disconnect from all connected brokers
   */
  async disconnectAll(): Promise<void> {
    const brokers = Array.from(this.adapters.keys());
    await Promise.all(brokers.map((b) => this.disconnect(b)));
  }

  /**
   * Get the adapter for a connected broker
   *
   * @param brokerType - The broker type
   * @returns The broker adapter or null if not connected
   */
  getAdapter(brokerType: BrokerType): BrokerAdapter | null {
    return this.adapters.get(brokerType) ?? null;
  }

  /**
   * Check if connected to a specific broker
   */
  isConnected(brokerType: BrokerType): boolean {
    return this.adapters.has(brokerType);
  }

  /**
   * Get list of connected brokers
   */
  getConnectedBrokers(): BrokerType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get connection state for a broker
   */
  getConnectionState(brokerType: BrokerType): ConnectionState | null {
    return this.connectionStates.get(brokerType) ?? null;
  }

  /**
   * Get connection states for all configured brokers
   */
  getAllConnectionStates(): Map<BrokerType, ConnectionState> {
    return new Map(this.connectionStates);
  }

  /**
   * Refresh account summary for a connected broker
   *
   * @param brokerType - The broker to refresh
   * @returns Updated account summary or null if not connected
   */
  async refreshAccountSummary(brokerType: BrokerType): Promise<AccountSummary | null> {
    const adapter = this.adapters.get(brokerType);
    if (!adapter) {
      return null;
    }

    try {
      const accountSummary = await adapter.getAccountSummary();
      this.updateConnectionState(brokerType, true, accountSummary);
      return accountSummary;
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.updateConnectionState(brokerType, false, undefined, errorMessage);

      // If auth error, disconnect
      if (error instanceof AuthenticationError) {
        await this.disconnect(brokerType);
      }

      throw error;
    }
  }

  /**
   * Validate credentials for a broker without connecting
   *
   * @param brokerType - The broker to validate
   * @returns Validation result
   */
  async validateCredentials(
    brokerType: BrokerType
  ): Promise<{ valid: boolean; errors: string[] }> {
    const credentials = await this.secretManager.getCredentials(brokerType, false);
    if (!credentials) {
      return {
        valid: false,
        errors: [`No credentials found for ${brokerType}`],
      };
    }

    const result = this.secretManager.validateCredentials(credentials);
    return {
      valid: result.valid,
      errors: result.errors,
    };
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  /**
   * Convert BrokerCredentials to BrokerConfig
   */
  private credentialsToBrokerConfig(credentials: BrokerCredentials): BrokerConfig {
    return {
      brokerType: credentials.brokerType,
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      accessToken: credentials.oauth?.accessToken,
      refreshToken: credentials.oauth?.refreshToken,
      accountId: credentials.accountId,
      sandbox: credentials.sandbox ?? true,
      baseUrl: credentials.baseUrl,
    };
  }

  /**
   * Update connection state for a broker
   */
  private updateConnectionState(
    brokerType: BrokerType,
    connected: boolean,
    accountSummary?: AccountSummary,
    error?: string
  ): void {
    const currentState = this.connectionStates.get(brokerType);

    this.connectionStates.set(brokerType, {
      brokerType,
      connected,
      lastConnected: connected ? new Date() : currentState?.lastConnected,
      lastError: error,
      accountSummary,
    });
  }

  /**
   * Get user-friendly error message from an error
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof BrokerError) {
      return error.toUserMessage();
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'An unknown error occurred';
  }
}

/**
 * Create a BrokerConnectionService from environment variables
 *
 * @param masterPasswordEnvVar - Env var for master password
 * @returns Initialized BrokerConnectionService
 */
export async function createBrokerConnectionService(
  secretManager: SecretManager
): Promise<BrokerConnectionService> {
  return new BrokerConnectionService(secretManager);
}
