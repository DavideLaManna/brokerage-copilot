/**
 * Secure Credential Storage (Secrets Manager)
 *
 * Provides encrypted storage for broker API credentials.
 * - Never logs tokens or secrets
 * - Supports multiple brokers
 * - Handles token refresh for OAuth providers
 * - Validates credentials on load
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { BrokerType } from '../types/broker.js';
import { encrypt, decrypt, maskSecret, type EncryptedData } from './encryption.js';
import {
  type OAuthTokens,
  shouldRefreshToken,
  refreshTokens,
  usesOAuth,
  supportsTokenRefresh,
} from './token-refresh.js';

/**
 * Broker credentials structure
 */
export interface BrokerCredentials {
  /** Type of broker */
  brokerType: BrokerType;
  /** API key or client ID */
  apiKey?: string;
  /** API secret or client secret */
  apiSecret?: string;
  /** OAuth tokens (for OAuth-based brokers) */
  oauth?: OAuthTokens;
  /** Account ID (some brokers require explicit account selection) */
  accountId?: string;
  /** Whether this is a sandbox/paper trading account */
  sandbox?: boolean;
  /** Custom base URL override */
  baseUrl?: string;
  /** Last validation timestamp */
  lastValidated?: number;
}

/**
 * Credential validation result
 */
export interface CredentialValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Stored credentials file format
 */
interface CredentialsFile {
  version: number;
  credentials: Record<string, EncryptedData>;
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Zod schema for broker credentials validation
 */
const BrokerCredentialsSchema = z.object({
  brokerType: z.enum(['alpaca', 'tradier', 'tastytrade', 'ibkr']),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  oauth: z
    .object({
      accessToken: z.string(),
      refreshToken: z.string().optional(),
      expiresAt: z.number().optional(),
      tokenType: z.string().optional(),
      scope: z.string().optional(),
    })
    .optional(),
  accountId: z.string().optional(),
  sandbox: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  lastValidated: z.number().optional(),
});

/**
 * Default secrets file path
 */
const DEFAULT_SECRETS_PATH = '.secrets/credentials.json';

/**
 * SecretManager - Handles secure credential storage
 *
 * IMPORTANT: This class is designed to NEVER log secrets.
 * All logging should use maskSecret() or omit sensitive fields entirely.
 */
export class SecretManager {
  private credentials: Map<BrokerType, BrokerCredentials> = new Map();
  private masterPassword: string;
  private secretsPath: string;
  private initialized: boolean = false;

  /**
   * Create a new SecretManager instance
   *
   * @param masterPassword - Password for encrypting/decrypting credentials
   * @param secretsPath - Path to the encrypted credentials file
   */
  constructor(masterPassword: string, secretsPath?: string) {
    if (!masterPassword || masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
    this.masterPassword = masterPassword;
    this.secretsPath = secretsPath || DEFAULT_SECRETS_PATH;
  }

  /**
   * Initialize the secret manager
   * - Creates secrets directory if needed
   * - Loads existing credentials if available
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure secrets directory exists
    const dir = path.dirname(this.secretsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Load existing credentials if file exists
    if (fs.existsSync(this.secretsPath)) {
      await this.loadCredentials();
    }

    this.initialized = true;
  }

  /**
   * Store credentials for a broker
   *
   * @param credentials - Broker credentials to store
   * @throws Error if credentials are invalid
   */
  async setCredentials(credentials: BrokerCredentials): Promise<void> {
    // Validate credentials structure
    const validation = this.validateCredentials(credentials);
    if (!validation.valid) {
      throw new Error(`Invalid credentials: ${validation.errors.join(', ')}`);
    }

    // Store in memory
    this.credentials.set(credentials.brokerType, {
      ...credentials,
      lastValidated: Date.now(),
    });

    // Persist to disk
    await this.saveCredentials();
  }

  /**
   * Get credentials for a broker
   *
   * @param brokerType - The broker to get credentials for
   * @param autoRefresh - Whether to auto-refresh expired OAuth tokens
   * @returns Credentials or null if not found
   */
  async getCredentials(
    brokerType: BrokerType,
    autoRefresh: boolean = true
  ): Promise<BrokerCredentials | null> {
    const creds = this.credentials.get(brokerType);

    if (!creds) {
      return null;
    }

    // Check if OAuth tokens need refresh
    if (autoRefresh && creds.oauth && shouldRefreshToken(creds.oauth.expiresAt)) {
      const refreshed = await this.refreshOAuthTokens(brokerType);
      if (refreshed) {
        return this.credentials.get(brokerType) || null;
      }
    }

    return creds;
  }

  /**
   * Remove credentials for a broker
   */
  async removeCredentials(brokerType: BrokerType): Promise<boolean> {
    const existed = this.credentials.delete(brokerType);
    if (existed) {
      await this.saveCredentials();
    }
    return existed;
  }

  /**
   * Check if credentials exist for a broker
   */
  hasCredentials(brokerType: BrokerType): boolean {
    return this.credentials.has(brokerType);
  }

  /**
   * Get list of configured brokers
   */
  getConfiguredBrokers(): BrokerType[] {
    return Array.from(this.credentials.keys());
  }

  /**
   * Validate credentials for a specific broker type
   */
  validateCredentials(credentials: BrokerCredentials): CredentialValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate with Zod schema
    const result = BrokerCredentialsSchema.safeParse(credentials);
    if (!result.success) {
      errors.push(...result.error.errors.map((e) => e.message));
      return { valid: false, errors, warnings };
    }

    // Broker-specific validation
    switch (credentials.brokerType) {
      case 'alpaca':
        if (!credentials.apiKey) errors.push('API key is required for Alpaca');
        if (!credentials.apiSecret) errors.push('API secret is required for Alpaca');
        break;

      case 'tradier':
        if (!credentials.oauth?.accessToken && !credentials.apiKey) {
          errors.push('Access token or API key is required for Tradier');
        }
        if (!credentials.accountId) {
          warnings.push('Account ID is recommended for Tradier');
        }
        break;

      case 'tastytrade':
        if (!credentials.apiKey) errors.push('Username (apiKey) is required for tastytrade');
        if (!credentials.apiSecret) errors.push('Password (apiSecret) is required for tastytrade');
        break;

      case 'ibkr':
        if (!credentials.baseUrl) {
          errors.push('TWS/Gateway URL (baseUrl) is required for IBKR');
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate all stored credentials on startup
   */
  async validateAllCredentials(): Promise<Map<BrokerType, CredentialValidationResult>> {
    const results = new Map<BrokerType, CredentialValidationResult>();

    for (const [brokerType, creds] of this.credentials) {
      results.set(brokerType, this.validateCredentials(creds));
    }

    return results;
  }

  /**
   * Refresh OAuth tokens for a broker
   */
  private async refreshOAuthTokens(brokerType: BrokerType): Promise<boolean> {
    const creds = this.credentials.get(brokerType);

    if (!creds?.oauth?.refreshToken) {
      return false;
    }

    if (!usesOAuth(brokerType) || !supportsTokenRefresh(brokerType)) {
      return false;
    }

    const result = await refreshTokens(brokerType, creds.oauth.refreshToken);

    if (result.success && result.tokens) {
      // Update credentials with new tokens
      const updatedCreds: BrokerCredentials = {
        ...creds,
        oauth: result.tokens,
        lastValidated: Date.now(),
      };
      this.credentials.set(brokerType, updatedCreds);
      await this.saveCredentials();
      return true;
    }

    return false;
  }

  /**
   * Load credentials from encrypted file
   */
  private async loadCredentials(): Promise<void> {
    try {
      const fileContent = fs.readFileSync(this.secretsPath, 'utf8');
      const credFile: CredentialsFile = JSON.parse(fileContent);

      for (const [brokerType, encryptedData] of Object.entries(credFile.credentials)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const credentials = JSON.parse(decrypted) as BrokerCredentials;
          this.credentials.set(brokerType as BrokerType, credentials);
        } catch {
          // Failed to decrypt - likely wrong password
          // Don't log the error details as they might contain hints about credentials
          console.error(`Failed to decrypt credentials for ${brokerType}`);
        }
      }
    } catch {
      // Failed to read or parse file
      console.error('Failed to load credentials file');
    }
  }

  /**
   * Save credentials to encrypted file
   */
  private async saveCredentials(): Promise<void> {
    const credFile: CredentialsFile = {
      version: 1,
      credentials: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    for (const [brokerType, creds] of this.credentials) {
      const plaintext = JSON.stringify(creds);
      credFile.credentials[brokerType] = encrypt(plaintext, this.masterPassword);
    }

    // Write with restrictive permissions (owner read/write only)
    const tempPath = `${this.secretsPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(credFile, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tempPath, this.secretsPath);
  }

  /**
   * Create a safe representation of credentials for logging
   * NEVER includes actual secrets
   */
  getSafeCredentialInfo(brokerType: BrokerType): Record<string, unknown> | null {
    const creds = this.credentials.get(brokerType);
    if (!creds) {
      return null;
    }

    return {
      brokerType: creds.brokerType,
      hasApiKey: !!creds.apiKey,
      apiKeyPrefix: creds.apiKey ? maskSecret(creds.apiKey) : undefined,
      hasApiSecret: !!creds.apiSecret,
      hasOAuth: !!creds.oauth,
      oauthExpiry: creds.oauth?.expiresAt
        ? new Date(creds.oauth.expiresAt).toISOString()
        : undefined,
      accountId: creds.accountId ? maskSecret(creds.accountId) : undefined,
      sandbox: creds.sandbox,
      lastValidated: creds.lastValidated
        ? new Date(creds.lastValidated).toISOString()
        : undefined,
    };
  }

  /**
   * Clear all credentials from memory (for security on shutdown)
   */
  clearMemory(): void {
    this.credentials.clear();
    this.initialized = false;
  }
}

/**
 * Create SecretManager from environment variables
 *
 * @param masterPasswordEnvVar - Environment variable name for master password
 * @param secretsPathEnvVar - Environment variable name for secrets path
 * @returns Initialized SecretManager instance
 */
export async function createSecretManagerFromEnv(
  masterPasswordEnvVar: string = 'SECRETS_MASTER_PASSWORD',
  secretsPathEnvVar: string = 'SECRETS_FILE_PATH'
): Promise<SecretManager> {
  const masterPassword = process.env[masterPasswordEnvVar];

  if (!masterPassword) {
    throw new Error(
      `Master password not found. Set the ${masterPasswordEnvVar} environment variable.`
    );
  }

  const secretsPath = process.env[secretsPathEnvVar] || DEFAULT_SECRETS_PATH;

  const manager = new SecretManager(masterPassword, secretsPath);
  await manager.initialize();

  return manager;
}

/**
 * Import credentials from environment variables (one-time migration)
 * This allows users to set credentials via env vars initially, then
 * store them securely in the encrypted file.
 */
export async function importCredentialsFromEnv(
  manager: SecretManager
): Promise<BrokerType[]> {
  const imported: BrokerType[] = [];

  // Check for Alpaca
  if (process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY) {
    await manager.setCredentials({
      brokerType: 'alpaca',
      apiKey: process.env.ALPACA_API_KEY,
      apiSecret: process.env.ALPACA_SECRET_KEY,
      baseUrl: process.env.ALPACA_BASE_URL,
      sandbox: process.env.ALPACA_BASE_URL?.includes('paper') ?? true,
    });
    imported.push('alpaca');
  }

  // Check for Tradier
  if (process.env.TRADIER_ACCESS_TOKEN) {
    await manager.setCredentials({
      brokerType: 'tradier',
      oauth: {
        accessToken: process.env.TRADIER_ACCESS_TOKEN,
      },
      accountId: process.env.TRADIER_ACCOUNT_ID,
      baseUrl: process.env.TRADIER_BASE_URL,
      sandbox: process.env.TRADIER_BASE_URL?.includes('sandbox') ?? true,
    });
    imported.push('tradier');
  }

  // Check for tastytrade
  if (process.env.TASTYTRADE_USERNAME && process.env.TASTYTRADE_PASSWORD) {
    await manager.setCredentials({
      brokerType: 'tastytrade',
      apiKey: process.env.TASTYTRADE_USERNAME,
      apiSecret: process.env.TASTYTRADE_PASSWORD,
      accountId: process.env.TASTYTRADE_ACCOUNT_NUMBER,
    });
    imported.push('tastytrade');
  }

  // Check for IBKR
  if (process.env.IBKR_HOST) {
    const port = process.env.IBKR_PORT || '7497';
    await manager.setCredentials({
      brokerType: 'ibkr',
      baseUrl: `http://${process.env.IBKR_HOST}:${port}`,
      accountId: process.env.IBKR_CLIENT_ID,
    });
    imported.push('ibkr');
  }

  return imported;
}
