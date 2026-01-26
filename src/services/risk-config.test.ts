/**
 * Tests for Risk Configuration Service
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  RiskConfigService,
  type RiskConfigServiceOptions,
} from './risk-config.js';
import {
  type RiskConfig,
  DEFAULT_RISK_CONFIG,
  validateRiskConfig,
  formatRiskConfigForDisplay,
  RiskConfigSchema,
} from '../types/risk-config.js';

describe('Risk Configuration Schema', () => {
  it('should validate a valid config', () => {
    const validConfig: RiskConfig = {
      maxRiskPerTradePercent: 2,
      maxRiskPerUnderlyingPercent: 10,
      maxDailyLoss: 1000,
      maxOpenPositions: 10,
      maxContractsPerPosition: 10,
      minDTE: 7,
      maxDTE: 60,
    };

    const result = RiskConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should reject negative percentages', () => {
    const invalidConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxRiskPerTradePercent: -1,
    };

    const result = RiskConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject percentages over 100', () => {
    const invalidConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxRiskPerUnderlyingPercent: 101,
    };

    const result = RiskConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject non-integer position counts', () => {
    const invalidConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxOpenPositions: 5.5,
    };

    const result = RiskConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject zero max positions', () => {
    const invalidConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxOpenPositions: 0,
    };

    const result = RiskConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should reject negative daily loss', () => {
    const invalidConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxDailyLoss: -500,
    };

    const result = RiskConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});

describe('Risk Configuration Validation', () => {
  it('should validate and return no errors for valid config', () => {
    const result = validateRiskConfig(DEFAULT_RISK_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject minDTE >= maxDTE', () => {
    const invalidConfig = {
      ...DEFAULT_RISK_CONFIG,
      minDTE: 60,
      maxDTE: 30,
    };

    const result = validateRiskConfig(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Min DTE'))).toBe(true);
  });

  it('should warn about aggressive risk settings', () => {
    const aggressiveConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxRiskPerTradePercent: 10, // > 5%
    };

    const result = validateRiskConfig(aggressiveConfig);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('aggressive'))).toBe(true);
  });

  it('should warn about high concentration risk', () => {
    const concentratedConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxRiskPerUnderlyingPercent: 30, // > 20%
    };

    const result = validateRiskConfig(concentratedConfig);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('concentration'))).toBe(true);
  });

  it('should warn about high contract counts', () => {
    const highContractsConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxContractsPerPosition: 100, // > 50
    };

    const result = validateRiskConfig(highContractsConfig);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('contracts'))).toBe(true);
  });

  it('should warn about low DTE', () => {
    const lowDTEConfig = {
      ...DEFAULT_RISK_CONFIG,
      minDTE: 1, // < 3
    };

    const result = validateRiskConfig(lowDTEConfig);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('gamma'))).toBe(true);
  });
});

describe('Risk Configuration Display', () => {
  it('should format config for display', () => {
    const formatted = formatRiskConfigForDisplay(DEFAULT_RISK_CONFIG);

    expect(formatted['Max Risk Per Trade']).toBe('2%');
    expect(formatted['Max Risk Per Underlying']).toBe('10%');
    expect(formatted['Max Daily Loss']).toBe('$1,000');
    expect(formatted['Max Open Positions']).toBe('10');
    expect(formatted['Max Contracts Per Position']).toBe('10');
    expect(formatted['DTE Range']).toBe('7 - 60 days');
  });
});

describe('RiskConfigService', () => {
  const testPassword = 'test-master-password-123';
  const testConfigDir = path.join(__dirname, '../../.test-config/risk');
  let service: RiskConfigService;

  beforeEach(async () => {
    // Clean up test directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }

    const options: RiskConfigServiceOptions = {
      masterPassword: testPassword,
      configDir: testConfigDir,
    };

    service = new RiskConfigService(options);
    await service.initialize();
  });

  afterEach(() => {
    service.clearMemory();

    // Clean up test directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true });
    }
  });

  it('should require minimum password length', () => {
    expect(
      () =>
        new RiskConfigService({
          masterPassword: 'short',
          configDir: testConfigDir,
        })
    ).toThrow('at least 8 characters');
  });

  it('should return default config for account without config', () => {
    const config = service.getActiveConfig('test-account');
    expect(config).toEqual(DEFAULT_RISK_CONFIG);
  });

  it('should create and retrieve a config', async () => {
    const customConfig: RiskConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxRiskPerTradePercent: 3,
      maxDailyLoss: 2000,
    };

    const stored = await service.createConfig('account-1', customConfig, {
      name: 'Test Config',
      setActive: true,
    });

    expect(stored.id).toBeDefined();
    expect(stored.name).toBe('Test Config');
    expect(stored.isActive).toBe(true);
    expect(stored.config.maxRiskPerTradePercent).toBe(3);
    expect(stored.config.maxDailyLoss).toBe(2000);

    const activeConfig = service.getActiveConfig('account-1');
    expect(activeConfig.maxRiskPerTradePercent).toBe(3);
  });

  it('should persist configs to disk', async () => {
    await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      name: 'Persistent Config',
      setActive: true,
    });

    // Create new service instance to load from disk
    const service2 = new RiskConfigService({
      masterPassword: testPassword,
      configDir: testConfigDir,
    });
    await service2.initialize();

    const config = service2.getActiveConfig('account-1');
    expect(config).toEqual(DEFAULT_RISK_CONFIG);

    const stored = service2.getActiveStoredConfig('account-1');
    expect(stored?.name).toBe('Persistent Config');

    service2.clearMemory();
  });

  it('should update a config', async () => {
    const stored = await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      setActive: true,
    });

    const updated = await service.updateConfig('account-1', stored.id, {
      maxRiskPerTradePercent: 5,
    });

    expect(updated.config.maxRiskPerTradePercent).toBe(5);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(
      updated.createdAt.getTime()
    );
  });

  it('should reject invalid updates', async () => {
    const stored = await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      setActive: true,
    });

    await expect(
      service.updateConfig('account-1', stored.id, {
        maxRiskPerTradePercent: 150, // Invalid: > 100
      })
    ).rejects.toThrow('Invalid risk config');
  });

  it('should manage multiple configs per account', async () => {
    await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      name: 'Conservative',
      setActive: true,
    });

    const aggressiveConfig: RiskConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxRiskPerTradePercent: 5,
      maxOpenPositions: 20,
    };

    await service.createConfig('account-1', aggressiveConfig, {
      name: 'Aggressive',
      setActive: false,
    });

    const allConfigs = service.getAllConfigs('account-1');
    expect(allConfigs).toHaveLength(2);

    const names = allConfigs.map((c) => c.name);
    expect(names).toContain('Conservative');
    expect(names).toContain('Aggressive');
  });

  it('should set active config and deactivate others', async () => {
    const config1 = await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      name: 'Config 1',
      setActive: true,
    });

    const config2 = await service.createConfig(
      'account-1',
      { ...DEFAULT_RISK_CONFIG, maxOpenPositions: 20 },
      {
        name: 'Config 2',
        setActive: false,
      }
    );

    // Config 1 should be active
    let active = service.getActiveStoredConfig('account-1');
    expect(active?.id).toBe(config1.id);

    // Set Config 2 as active
    await service.setActiveConfig('account-1', config2.id);

    active = service.getActiveStoredConfig('account-1');
    expect(active?.id).toBe(config2.id);

    // Check Config 1 is no longer active
    const allConfigs = service.getAllConfigs('account-1');
    const config1Updated = allConfigs.find((c) => c.id === config1.id);
    expect(config1Updated?.isActive).toBe(false);
  });

  it('should delete a config', async () => {
    const config = await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      setActive: true,
    });

    expect(service.hasConfig('account-1')).toBe(true);

    const deleted = await service.deleteConfig('account-1', config.id);
    expect(deleted).toBe(true);

    expect(service.hasConfig('account-1')).toBe(false);
    expect(service.getActiveStoredConfig('account-1')).toBeNull();
  });

  it('should create default config for new account', async () => {
    const stored = await service.createDefaultConfig('new-account');

    expect(stored.name).toBe('Default');
    expect(stored.isActive).toBe(true);
    expect(stored.config).toEqual(DEFAULT_RISK_CONFIG);
  });

  it('should reject invalid config on create', async () => {
    const invalidConfig = {
      ...DEFAULT_RISK_CONFIG,
      minDTE: 100,
      maxDTE: 50, // Invalid: minDTE > maxDTE
    };

    await expect(
      service.createConfig('account-1', invalidConfig)
    ).rejects.toThrow('Invalid risk config');
  });

  it('should handle non-existent account on update', async () => {
    await expect(
      service.updateConfig('non-existent', 'fake-id', {
        maxRiskPerTradePercent: 5,
      })
    ).rejects.toThrow('No configurations found');
  });

  it('should handle non-existent config on update', async () => {
    await service.createConfig('account-1', DEFAULT_RISK_CONFIG);

    await expect(
      service.updateConfig('account-1', 'non-existent-id', {
        maxRiskPerTradePercent: 5,
      })
    ).rejects.toThrow('not found');
  });

  it('should handle non-existent config on set active', async () => {
    await service.createConfig('account-1', DEFAULT_RISK_CONFIG);

    await expect(
      service.setActiveConfig('account-1', 'non-existent-id')
    ).rejects.toThrow('not found');
  });

  it('should return false when deleting non-existent config', async () => {
    const deleted = await service.deleteConfig('account-1', 'non-existent-id');
    expect(deleted).toBe(false);
  });

  it('should validate config without saving', () => {
    const result = service.validateConfig({
      maxRiskPerTradePercent: 2,
      maxRiskPerUnderlyingPercent: 10,
      maxDailyLoss: 1000,
      maxOpenPositions: 10,
      maxContractsPerPosition: 10,
      minDTE: 7,
      maxDTE: 60,
    });

    expect(result.valid).toBe(true);
  });

  it('should clear memory', async () => {
    await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      setActive: true,
    });

    expect(service.hasConfig('account-1')).toBe(true);

    service.clearMemory();

    expect(service.hasConfig('account-1')).toBe(false);
  });

  it('should handle multiple accounts independently', async () => {
    await service.createConfig('account-1', DEFAULT_RISK_CONFIG, {
      setActive: true,
    });

    const account2Config: RiskConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxRiskPerTradePercent: 5,
    };

    await service.createConfig('account-2', account2Config, {
      setActive: true,
    });

    expect(service.getActiveConfig('account-1').maxRiskPerTradePercent).toBe(2);
    expect(service.getActiveConfig('account-2').maxRiskPerTradePercent).toBe(5);
  });
});
