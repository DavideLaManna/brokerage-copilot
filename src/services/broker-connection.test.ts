/**
 * Broker Connection Service Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrokerConnectionService } from './broker-connection.js';
import { SecretManager } from '../storage/secrets.js';
import type { BrokerCredentials } from '../storage/secrets.js';
import type { BrokerAdapter, AccountSummary } from '../types/broker.js';
import { BrokerErrorCode, AuthenticationError } from '../types/errors.js';

// Mock the broker-factory module
vi.mock('../adapters/broker-factory.js', () => ({
  createBrokerAdapter: vi.fn(),
}));

import { createBrokerAdapter } from '../adapters/broker-factory.js';

describe('BrokerConnectionService', () => {
  let secretManager: SecretManager;
  let service: BrokerConnectionService;
  let mockAdapter: BrokerAdapter;

  const mockAccountSummary: AccountSummary = {
    netLiquidation: 50000,
    buyingPower: 25000,
    cash: 25000,
    dailyPnL: 150,
    unrealizedPnL: 500,
    currency: 'USD',
    asOf: new Date(),
  };

  beforeEach(() => {
    // Create a mock SecretManager
    secretManager = new SecretManager('test-password-12345', '/tmp/test-secrets.json');

    // Create mock adapter
    mockAdapter = {
      brokerType: 'tradier',
      brokerName: 'Tradier',
      validateConnection: vi.fn().mockResolvedValue(true),
      getAccountSummary: vi.fn().mockResolvedValue(mockAccountSummary),
      getPositions: vi.fn().mockResolvedValue([]),
      getOpenOrders: vi.fn().mockResolvedValue([]),
      getOrder: vi.fn().mockResolvedValue(null),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn().mockResolvedValue(true),
      getQuote: vi.fn(),
      getOptionChain: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    // Reset mocks
    vi.mocked(createBrokerAdapter).mockReset();
    vi.mocked(createBrokerAdapter).mockResolvedValue(mockAdapter);

    service = new BrokerConnectionService(secretManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('should return error when no credentials found', async () => {
      // SecretManager has no credentials by default
      const result = await service.connect('tradier');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No credentials found');
      expect(result.errorCode).toBe(BrokerErrorCode.INVALID_CREDENTIALS);
    });

    it('should connect successfully with valid credentials', async () => {
      // Store credentials
      const credentials: BrokerCredentials = {
        brokerType: 'tradier',
        oauth: {
          accessToken: 'test-token',
        },
        accountId: 'ABC123',
        sandbox: true,
      };
      await secretManager.setCredentials(credentials);

      const result = await service.connect('tradier');

      expect(result.success).toBe(true);
      expect(result.accountSummary).toBeDefined();
      expect(result.accountSummary?.netLiquidation).toBe(50000);
      expect(createBrokerAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          brokerType: 'tradier',
          accessToken: 'test-token',
          accountId: 'ABC123',
        })
      );
    });

    it('should reuse existing connection if valid', async () => {
      // Store credentials and connect
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');
      const result = await service.connect('tradier');

      expect(result.success).toBe(true);
      // createBrokerAdapter should only be called once
      expect(createBrokerAdapter).toHaveBeenCalledTimes(1);
    });

    it('should handle connection errors gracefully', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'invalid-token' },
        accountId: 'ABC123',
      });

      vi.mocked(createBrokerAdapter).mockRejectedValue(
        new AuthenticationError(
          BrokerErrorCode.AUTHENTICATION_FAILED,
          'Invalid credentials',
          'tradier'
        )
      );

      const result = await service.connect('tradier');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to authenticate with broker. Please check your credentials.');
      expect(result.errorCode).toBe(BrokerErrorCode.AUTHENTICATION_FAILED);
    });
  });

  describe('disconnect', () => {
    it('should return false when not connected', async () => {
      const result = await service.disconnect('tradier');
      expect(result).toBe(false);
    });

    it('should disconnect successfully when connected', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');
      expect(service.isConnected('tradier')).toBe(true);

      const result = await service.disconnect('tradier');

      expect(result).toBe(true);
      expect(service.isConnected('tradier')).toBe(false);
      expect(mockAdapter.disconnect).toHaveBeenCalled();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all connected brokers', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');
      await service.disconnectAll();

      expect(service.getConnectedBrokers()).toHaveLength(0);
    });
  });

  describe('getAdapter', () => {
    it('should return null when not connected', () => {
      const adapter = service.getAdapter('tradier');
      expect(adapter).toBeNull();
    });

    it('should return adapter when connected', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');
      const adapter = service.getAdapter('tradier');

      expect(adapter).toBe(mockAdapter);
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(service.isConnected('tradier')).toBe(false);
    });

    it('should return true when connected', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');
      expect(service.isConnected('tradier')).toBe(true);
    });
  });

  describe('getConnectedBrokers', () => {
    it('should return empty array when no brokers connected', () => {
      expect(service.getConnectedBrokers()).toEqual([]);
    });

    it('should return list of connected brokers', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');
      expect(service.getConnectedBrokers()).toEqual(['tradier']);
    });
  });

  describe('getConnectionState', () => {
    it('should return null when no state exists', () => {
      expect(service.getConnectionState('tradier')).toBeNull();
    });

    it('should return connection state after connect attempt', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');
      const state = service.getConnectionState('tradier');

      expect(state).toBeDefined();
      expect(state?.connected).toBe(true);
      expect(state?.brokerType).toBe('tradier');
      expect(state?.accountSummary).toBeDefined();
    });

    it('should track error state on failed connection', async () => {
      const result = await service.connect('tradier');
      const state = service.getConnectionState('tradier');

      expect(result.success).toBe(false);
      expect(state?.connected).toBe(false);
      expect(state?.lastError).toBeDefined();
    });
  });

  describe('refreshAccountSummary', () => {
    it('should return null when not connected', async () => {
      const result = await service.refreshAccountSummary('tradier');
      expect(result).toBeNull();
    });

    it('should refresh and return account summary', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      await service.connect('tradier');

      // Update mock to return different values
      const newSummary = { ...mockAccountSummary, netLiquidation: 60000 };
      vi.mocked(mockAdapter.getAccountSummary).mockResolvedValue(newSummary);

      const result = await service.refreshAccountSummary('tradier');

      expect(result).toBeDefined();
      expect(result?.netLiquidation).toBe(60000);
    });
  });

  describe('validateCredentials', () => {
    it('should return invalid when no credentials exist', async () => {
      const result = await service.validateCredentials('tradier');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No credentials found for tradier');
    });

    it('should validate existing credentials', async () => {
      await secretManager.setCredentials({
        brokerType: 'tradier',
        oauth: { accessToken: 'test-token' },
        accountId: 'ABC123',
      });

      const result = await service.validateCredentials('tradier');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
