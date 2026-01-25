/**
 * Tests for Secure Credential Storage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  encrypt,
  decrypt,
  maskSecret,
  hashValue,
  secureCompare,
  generateSecureRandom,
} from './encryption.js';
import {
  shouldRefreshToken,
  calculateExpiresAt,
  usesOAuth,
} from './token-refresh.js';
import {
  SecretManager,
  type BrokerCredentials,
} from './secrets.js';

describe('Encryption utilities', () => {
  const testPassword = 'test-password-12345';
  const testPlaintext = 'secret-api-key-12345';

  it('should encrypt and decrypt correctly', () => {
    const encrypted = encrypt(testPlaintext, testPassword);

    expect(encrypted.iv).toBeDefined();
    expect(encrypted.data).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.salt).toBeDefined();

    const decrypted = decrypt(encrypted, testPassword);
    expect(decrypted).toBe(testPlaintext);
  });

  it('should fail decryption with wrong password', () => {
    const encrypted = encrypt(testPlaintext, testPassword);

    expect(() => decrypt(encrypted, 'wrong-password')).toThrow();
  });

  it('should produce different ciphertext for same plaintext', () => {
    const encrypted1 = encrypt(testPlaintext, testPassword);
    const encrypted2 = encrypt(testPlaintext, testPassword);

    // IVs and salts should be different
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.salt).not.toBe(encrypted2.salt);
    // Ciphertext should be different
    expect(encrypted1.data).not.toBe(encrypted2.data);
  });

  it('should mask secrets appropriately', () => {
    expect(maskSecret('abcdefghij')).toBe('ab******ij');
    expect(maskSecret('short')).toBe('****');
    expect(maskSecret('')).toBe('****');
    expect(maskSecret('12345678')).toBe('12****78');
  });

  it('should hash values consistently', () => {
    const hash1 = hashValue('test-value');
    const hash2 = hashValue('test-value');

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 produces 64 hex chars
  });

  it('should securely compare strings', () => {
    expect(secureCompare('test', 'test')).toBe(true);
    expect(secureCompare('test', 'Test')).toBe(false);
    expect(secureCompare('test', 'testing')).toBe(false);
  });

  it('should generate secure random strings', () => {
    const random1 = generateSecureRandom(16);
    const random2 = generateSecureRandom(16);

    expect(random1.length).toBe(32); // 16 bytes = 32 hex chars
    expect(random2.length).toBe(32);
    expect(random1).not.toBe(random2);
  });
});

describe('Token refresh logic', () => {
  it('should determine when token needs refresh', () => {
    const now = Date.now();

    // Token expired
    expect(shouldRefreshToken(now - 1000)).toBe(true);

    // Token expiring soon (within buffer)
    expect(shouldRefreshToken(now + 60 * 1000)).toBe(true);

    // Token not expiring soon
    expect(shouldRefreshToken(now + 10 * 60 * 1000)).toBe(false);

    // No expiration info
    expect(shouldRefreshToken(undefined)).toBe(false);
  });

  it('should calculate expiration timestamp', () => {
    const before = Date.now();
    const expiresAt = calculateExpiresAt(3600); // 1 hour
    const after = Date.now();

    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 3600 * 1000);
  });

  it('should identify OAuth brokers', () => {
    expect(usesOAuth('tradier')).toBe(true);
    expect(usesOAuth('alpaca')).toBe(false);
    expect(usesOAuth('tastytrade')).toBe(false);
    expect(usesOAuth('ibkr')).toBe(false);
  });
});

describe('SecretManager', () => {
  const testPassword = 'test-master-password-123';
  const testSecretsPath = path.join(__dirname, '../../.test-secrets/creds.json');
  let manager: SecretManager;

  beforeEach(async () => {
    // Clean up test directory
    const dir = path.dirname(testSecretsPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }

    manager = new SecretManager(testPassword, testSecretsPath);
    await manager.initialize();
  });

  afterEach(() => {
    manager.clearMemory();

    // Clean up test directory
    const dir = path.dirname(testSecretsPath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('should require minimum password length', () => {
    expect(() => new SecretManager('short')).toThrow('at least 8 characters');
  });

  it('should store and retrieve credentials', async () => {
    const creds: BrokerCredentials = {
      brokerType: 'alpaca',
      apiKey: 'test-api-key',
      apiSecret: 'test-api-secret',
      sandbox: true,
    };

    await manager.setCredentials(creds);

    const retrieved = await manager.getCredentials('alpaca');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.apiKey).toBe('test-api-key');
    expect(retrieved?.apiSecret).toBe('test-api-secret');
    expect(retrieved?.sandbox).toBe(true);
  });

  it('should persist credentials to disk', async () => {
    const creds: BrokerCredentials = {
      brokerType: 'tradier',
      oauth: {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
      },
      accountId: 'test-account-id',
    };

    await manager.setCredentials(creds);

    // Create new manager instance to load from disk
    const manager2 = new SecretManager(testPassword, testSecretsPath);
    await manager2.initialize();

    const retrieved = await manager2.getCredentials('tradier');
    expect(retrieved?.oauth?.accessToken).toBe('test-access-token');
    expect(retrieved?.accountId).toBe('test-account-id');

    manager2.clearMemory();
  });

  it('should validate Alpaca credentials', () => {
    const validCreds: BrokerCredentials = {
      brokerType: 'alpaca',
      apiKey: 'key',
      apiSecret: 'secret',
    };

    const invalidCreds: BrokerCredentials = {
      brokerType: 'alpaca',
      // Missing apiKey and apiSecret
    };

    expect(manager.validateCredentials(validCreds).valid).toBe(true);
    expect(manager.validateCredentials(invalidCreds).valid).toBe(false);
  });

  it('should validate Tradier credentials', () => {
    const validCreds: BrokerCredentials = {
      brokerType: 'tradier',
      oauth: { accessToken: 'token' },
    };

    const invalidCreds: BrokerCredentials = {
      brokerType: 'tradier',
      // Missing oauth or apiKey
    };

    expect(manager.validateCredentials(validCreds).valid).toBe(true);
    expect(manager.validateCredentials(invalidCreds).valid).toBe(false);
  });

  it('should validate tastytrade credentials', () => {
    const validCreds: BrokerCredentials = {
      brokerType: 'tastytrade',
      apiKey: 'username',
      apiSecret: 'password',
    };

    const invalidCreds: BrokerCredentials = {
      brokerType: 'tastytrade',
      apiKey: 'username',
      // Missing apiSecret (password)
    };

    expect(manager.validateCredentials(validCreds).valid).toBe(true);
    expect(manager.validateCredentials(invalidCreds).valid).toBe(false);
  });

  it('should validate IBKR credentials', () => {
    const validCreds: BrokerCredentials = {
      brokerType: 'ibkr',
      baseUrl: 'http://127.0.0.1:7497',
    };

    const invalidCreds: BrokerCredentials = {
      brokerType: 'ibkr',
      // Missing baseUrl
    };

    expect(manager.validateCredentials(validCreds).valid).toBe(true);
    expect(manager.validateCredentials(invalidCreds).valid).toBe(false);
  });

  it('should remove credentials', async () => {
    await manager.setCredentials({
      brokerType: 'alpaca',
      apiKey: 'key',
      apiSecret: 'secret',
    });

    expect(manager.hasCredentials('alpaca')).toBe(true);

    const removed = await manager.removeCredentials('alpaca');
    expect(removed).toBe(true);
    expect(manager.hasCredentials('alpaca')).toBe(false);
  });

  it('should list configured brokers', async () => {
    await manager.setCredentials({
      brokerType: 'alpaca',
      apiKey: 'key',
      apiSecret: 'secret',
    });
    await manager.setCredentials({
      brokerType: 'tradier',
      oauth: { accessToken: 'token' },
    });

    const brokers = manager.getConfiguredBrokers();
    expect(brokers).toContain('alpaca');
    expect(brokers).toContain('tradier');
    expect(brokers.length).toBe(2);
  });

  it('should provide safe credential info for logging', async () => {
    await manager.setCredentials({
      brokerType: 'alpaca',
      apiKey: 'PKABCDEFGHIJ123456',
      apiSecret: 'supersecretapisecret12345',
      sandbox: true,
    });

    const safeInfo = manager.getSafeCredentialInfo('alpaca');
    expect(safeInfo).not.toBeNull();
    expect(safeInfo?.hasApiKey).toBe(true);
    expect(safeInfo?.hasApiSecret).toBe(true);
    expect(safeInfo?.apiKeyPrefix).toBe('PK**************56');
    expect(safeInfo?.sandbox).toBe(true);

    // Ensure actual secrets are not in the safe info
    expect(JSON.stringify(safeInfo)).not.toContain('PKABCDEFGHIJ123456');
    expect(JSON.stringify(safeInfo)).not.toContain('supersecretapisecret12345');
  });

  it('should validate all credentials', async () => {
    await manager.setCredentials({
      brokerType: 'alpaca',
      apiKey: 'key',
      apiSecret: 'secret',
    });

    const results = await manager.validateAllCredentials();
    expect(results.get('alpaca')?.valid).toBe(true);
  });

  it('should clear memory on demand', async () => {
    await manager.setCredentials({
      brokerType: 'alpaca',
      apiKey: 'key',
      apiSecret: 'secret',
    });

    expect(manager.hasCredentials('alpaca')).toBe(true);

    manager.clearMemory();

    expect(manager.hasCredentials('alpaca')).toBe(false);
  });
});
