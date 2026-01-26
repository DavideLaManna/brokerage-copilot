/**
 * Risk Configuration Service
 *
 * Handles CRUD operations for user risk configurations.
 * Stores configurations in an encrypted JSON file per account.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  type RiskConfig,
  type StoredRiskConfig,
  type RiskConfigValidationResult,
  RiskConfigWithValidationSchema,
  DEFAULT_RISK_CONFIG,
  validateRiskConfig,
} from '../types/risk-config.js';
import { encrypt, decrypt, type EncryptedData } from '../storage/encryption.js';

/**
 * Stored configuration file format
 */
interface RiskConfigFile {
  version: number;
  configs: Record<string, EncryptedData>; // key = config id
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Configuration options for RiskConfigService
 */
export interface RiskConfigServiceOptions {
  /** Directory to store risk config files */
  configDir?: string;
  /** Master password for encryption */
  masterPassword: string;
}

const DEFAULT_CONFIG_DIR = '.config/risk';

/**
 * RiskConfigService - Manages risk configurations for user accounts
 */
export class RiskConfigService {
  private configs: Map<string, StoredRiskConfig[]> = new Map(); // key = accountId
  private activeConfigs: Map<string, StoredRiskConfig> = new Map(); // key = accountId
  private configDir: string;
  private masterPassword: string;
  private initialized: boolean = false;

  constructor(options: RiskConfigServiceOptions) {
    if (!options.masterPassword || options.masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
    this.masterPassword = options.masterPassword;
    this.configDir = options.configDir || DEFAULT_CONFIG_DIR;
  }

  /**
   * Initialize the service
   * - Creates config directory if needed
   * - Loads existing configurations
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure config directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }

    // Load existing config files
    await this.loadAllConfigs();

    this.initialized = true;
  }

  /**
   * Get the active risk configuration for an account
   * Returns default config if none is set
   */
  getActiveConfig(accountId: string): RiskConfig {
    const active = this.activeConfigs.get(accountId);
    return active?.config ?? DEFAULT_RISK_CONFIG;
  }

  /**
   * Get the full stored configuration (with metadata) for an account
   */
  getActiveStoredConfig(accountId: string): StoredRiskConfig | null {
    return this.activeConfigs.get(accountId) ?? null;
  }

  /**
   * Get all configurations for an account
   */
  getAllConfigs(accountId: string): StoredRiskConfig[] {
    return this.configs.get(accountId) ?? [];
  }

  /**
   * Create a new risk configuration
   */
  async createConfig(
    accountId: string,
    config: RiskConfig,
    options?: { name?: string; setActive?: boolean }
  ): Promise<StoredRiskConfig> {
    // Validate the configuration
    const validation = validateRiskConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid risk config: ${validation.errors.join(', ')}`);
    }

    const now = new Date();
    const storedConfig: StoredRiskConfig = {
      id: randomUUID(),
      accountId,
      config,
      createdAt: now,
      updatedAt: now,
      name: options?.name,
      isActive: options?.setActive ?? false,
    };

    // If setting as active, deactivate others
    if (storedConfig.isActive) {
      this.deactivateAllConfigs(accountId);
    }

    // Add to memory
    const accountConfigs = this.configs.get(accountId) ?? [];
    accountConfigs.push(storedConfig);
    this.configs.set(accountId, accountConfigs);

    if (storedConfig.isActive) {
      this.activeConfigs.set(accountId, storedConfig);
    }

    // Persist
    await this.saveAccountConfigs(accountId);

    return storedConfig;
  }

  /**
   * Update an existing risk configuration
   */
  async updateConfig(
    accountId: string,
    configId: string,
    updates: Partial<RiskConfig>
  ): Promise<StoredRiskConfig> {
    const accountConfigs = this.configs.get(accountId);
    if (!accountConfigs) {
      throw new Error(`No configurations found for account ${accountId}`);
    }

    const configIndex = accountConfigs.findIndex((c) => c.id === configId);
    const existingConfig = accountConfigs[configIndex];
    if (configIndex === -1 || !existingConfig) {
      throw new Error(`Configuration ${configId} not found`);
    }

    const updatedRiskConfig = {
      ...existingConfig.config,
      ...updates,
    };

    // Validate the updated configuration
    const validation = validateRiskConfig(updatedRiskConfig);
    if (!validation.valid) {
      throw new Error(`Invalid risk config: ${validation.errors.join(', ')}`);
    }

    const updatedStoredConfig: StoredRiskConfig = {
      id: existingConfig.id,
      accountId: existingConfig.accountId,
      config: updatedRiskConfig,
      createdAt: existingConfig.createdAt,
      updatedAt: new Date(),
      name: existingConfig.name,
      isActive: existingConfig.isActive,
    };

    // Update in memory
    accountConfigs[configIndex] = updatedStoredConfig;

    // Update active config if this was active
    if (updatedStoredConfig.isActive) {
      this.activeConfigs.set(accountId, updatedStoredConfig);
    }

    // Persist
    await this.saveAccountConfigs(accountId);

    return updatedStoredConfig;
  }

  /**
   * Set a configuration as active
   */
  async setActiveConfig(accountId: string, configId: string): Promise<void> {
    const accountConfigs = this.configs.get(accountId);
    if (!accountConfigs) {
      throw new Error(`No configurations found for account ${accountId}`);
    }

    const config = accountConfigs.find((c) => c.id === configId);
    if (!config) {
      throw new Error(`Configuration ${configId} not found`);
    }

    // Deactivate all others
    this.deactivateAllConfigs(accountId);

    // Activate this one
    config.isActive = true;
    config.updatedAt = new Date();
    this.activeConfigs.set(accountId, config);

    // Persist
    await this.saveAccountConfigs(accountId);
  }

  /**
   * Delete a configuration
   */
  async deleteConfig(accountId: string, configId: string): Promise<boolean> {
    const accountConfigs = this.configs.get(accountId);
    if (!accountConfigs) {
      return false;
    }

    const configIndex = accountConfigs.findIndex((c) => c.id === configId);
    const config = accountConfigs[configIndex];
    if (configIndex === -1 || !config) {
      return false;
    }

    // Remove from array
    accountConfigs.splice(configIndex, 1);

    // If this was active, clear active config
    if (config.isActive) {
      this.activeConfigs.delete(accountId);
    }

    // Persist
    await this.saveAccountConfigs(accountId);

    return true;
  }

  /**
   * Validate a configuration without saving
   */
  validateConfig(config: unknown): RiskConfigValidationResult {
    return validateRiskConfig(config);
  }

  /**
   * Get the default risk configuration
   */
  getDefaultConfig(): RiskConfig {
    return { ...DEFAULT_RISK_CONFIG };
  }

  /**
   * Check if an account has any configurations
   */
  hasConfig(accountId: string): boolean {
    const configs = this.configs.get(accountId);
    return configs !== undefined && configs.length > 0;
  }

  /**
   * Create default configuration for a new account
   */
  async createDefaultConfig(accountId: string): Promise<StoredRiskConfig> {
    return this.createConfig(accountId, DEFAULT_RISK_CONFIG, {
      name: 'Default',
      setActive: true,
    });
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private deactivateAllConfigs(accountId: string): void {
    const accountConfigs = this.configs.get(accountId);
    if (accountConfigs) {
      for (const config of accountConfigs) {
        config.isActive = false;
      }
    }
    this.activeConfigs.delete(accountId);
  }

  private getConfigFilePath(accountId: string): string {
    // Sanitize accountId for filename
    const safeAccountId = accountId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.configDir, `risk-config-${safeAccountId}.json`);
  }

  private async loadAllConfigs(): Promise<void> {
    if (!fs.existsSync(this.configDir)) {
      return;
    }

    const files = fs.readdirSync(this.configDir);
    for (const file of files) {
      if (file.startsWith('risk-config-') && file.endsWith('.json')) {
        await this.loadConfigFile(path.join(this.configDir, file));
      }
    }
  }

  private async loadConfigFile(filePath: string): Promise<void> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const configFile: RiskConfigFile = JSON.parse(fileContent);

      for (const [configId, encryptedData] of Object.entries(configFile.configs)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const storedConfig = JSON.parse(decrypted) as StoredRiskConfig;

          // Convert date strings back to Date objects
          storedConfig.createdAt = new Date(storedConfig.createdAt);
          storedConfig.updatedAt = new Date(storedConfig.updatedAt);

          const accountId = storedConfig.accountId;

          // Add to configs map
          const accountConfigs = this.configs.get(accountId) ?? [];
          accountConfigs.push(storedConfig);
          this.configs.set(accountId, accountConfigs);

          // Track active config
          if (storedConfig.isActive) {
            this.activeConfigs.set(accountId, storedConfig);
          }
        } catch {
          console.error(`Failed to decrypt config ${configId}`);
        }
      }
    } catch {
      console.error(`Failed to load config file ${filePath}`);
    }
  }

  private async saveAccountConfigs(accountId: string): Promise<void> {
    const accountConfigs = this.configs.get(accountId);
    if (!accountConfigs || accountConfigs.length === 0) {
      // Delete file if no configs
      const filePath = this.getConfigFilePath(accountId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    const configFile: RiskConfigFile = {
      version: 1,
      configs: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    for (const config of accountConfigs) {
      const plaintext = JSON.stringify(config);
      configFile.configs[config.id] = encrypt(plaintext, this.masterPassword);
    }

    const filePath = this.getConfigFilePath(accountId);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Write with restrictive permissions
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(configFile, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  }

  /**
   * Clear all in-memory data (for shutdown/testing)
   */
  clearMemory(): void {
    this.configs.clear();
    this.activeConfigs.clear();
    this.initialized = false;
  }
}

/**
 * Create RiskConfigService from environment variables
 */
export async function createRiskConfigServiceFromEnv(
  masterPasswordEnvVar: string = 'SECRETS_MASTER_PASSWORD',
  configDirEnvVar: string = 'RISK_CONFIG_DIR'
): Promise<RiskConfigService> {
  const masterPassword = process.env[masterPasswordEnvVar];

  if (!masterPassword) {
    throw new Error(
      `Master password not found. Set the ${masterPasswordEnvVar} environment variable.`
    );
  }

  const configDir = process.env[configDirEnvVar] || DEFAULT_CONFIG_DIR;

  const service = new RiskConfigService({
    masterPassword,
    configDir,
  });

  await service.initialize();

  return service;
}
