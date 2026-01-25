import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerBrokerAdapter,
  isAdapterRegistered,
  getRegisteredBrokers,
  createBrokerAdapter,
  validateBrokerConfig,
  getBrokerEnvVars,
  createConfigFromEnv,
} from './broker-factory.js';
import type { BrokerAdapter, BrokerType } from '../types/broker.js';
import { BrokerError, BrokerErrorCode } from '../types/errors.js';

// Mock adapter for testing
function createMockAdapter(brokerType: BrokerType): BrokerAdapter {
  return {
    brokerType,
    brokerName: `Mock ${brokerType}`,
    getAccountSummary: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn(),
    getOrder: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  };
}

describe('Broker Factory', () => {
  describe('registerBrokerAdapter', () => {
    it('should register an adapter constructor', async () => {
      const mockConstructor = vi.fn().mockResolvedValue(createMockAdapter('alpaca'));

      registerBrokerAdapter('alpaca', mockConstructor);

      expect(isAdapterRegistered('alpaca')).toBe(true);
    });
  });

  describe('getRegisteredBrokers', () => {
    it('should return list of registered broker types', () => {
      const brokers = getRegisteredBrokers();
      expect(Array.isArray(brokers)).toBe(true);
    });
  });

  describe('createBrokerAdapter', () => {
    beforeEach(() => {
      // Register a test adapter
      registerBrokerAdapter('tradier', async () => createMockAdapter('tradier'));
    });

    it('should create adapter for registered broker', async () => {
      const adapter = await createBrokerAdapter({
        brokerType: 'tradier',
        accessToken: 'test-token',
      });

      expect(adapter.brokerType).toBe('tradier');
    });

    it('should throw error for unregistered broker', async () => {
      await expect(
        createBrokerAdapter({
          brokerType: 'ibkr', // Not registered in this test
          baseUrl: 'http://localhost',
        })
      ).rejects.toThrow(BrokerError);
    });

    it('should validate connection after creation', async () => {
      const failingAdapter = createMockAdapter('tastytrade');
      (failingAdapter.validateConnection as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      registerBrokerAdapter('tastytrade', async () => failingAdapter);

      await expect(
        createBrokerAdapter({
          brokerType: 'tastytrade',
          apiKey: 'user',
          apiSecret: 'pass',
        })
      ).rejects.toThrow(BrokerError);
    });
  });

  describe('validateBrokerConfig', () => {
    it('should validate Alpaca config requires apiKey and apiSecret', () => {
      const result = validateBrokerConfig({
        brokerType: 'alpaca',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('apiKey is required for Alpaca');
      expect(result.errors).toContain('apiSecret is required for Alpaca');
    });

    it('should pass validation with complete Alpaca config', () => {
      const result = validateBrokerConfig({
        brokerType: 'alpaca',
        apiKey: 'key',
        apiSecret: 'secret',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate Tradier config requires accessToken', () => {
      const result = validateBrokerConfig({
        brokerType: 'tradier',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('accessToken is required for Tradier');
    });

    it('should validate IBKR config requires baseUrl', () => {
      const result = validateBrokerConfig({
        brokerType: 'ibkr',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('baseUrl (TWS/Gateway URL) is required for IBKR');
    });
  });

  describe('getBrokerEnvVars', () => {
    it('should return correct environment variable names', () => {
      const envVars = getBrokerEnvVars('alpaca');

      expect(envVars.apiKey).toBe('ALPACA_API_KEY');
      expect(envVars.apiSecret).toBe('ALPACA_API_SECRET');
      expect(envVars.accessToken).toBe('ALPACA_ACCESS_TOKEN');
      expect(envVars.accountId).toBe('ALPACA_ACCOUNT_ID');
      expect(envVars.baseUrl).toBe('ALPACA_BASE_URL');
    });

    it('should handle different broker types', () => {
      const tradierVars = getBrokerEnvVars('tradier');
      expect(tradierVars.apiKey).toBe('TRADIER_API_KEY');

      const ibkrVars = getBrokerEnvVars('ibkr');
      expect(ibkrVars.baseUrl).toBe('IBKR_BASE_URL');
    });
  });

  describe('createConfigFromEnv', () => {
    it('should create config from environment variables', () => {
      // Set up test environment
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        ALPACA_API_KEY: 'test-key',
        ALPACA_API_SECRET: 'test-secret',
        NODE_ENV: 'test',
      };

      const config = createConfigFromEnv('alpaca');

      expect(config.brokerType).toBe('alpaca');
      expect(config.apiKey).toBe('test-key');
      expect(config.apiSecret).toBe('test-secret');
      expect(config.sandbox).toBe(true); // Not production

      // Restore environment
      process.env = originalEnv;
    });
  });
});

describe('BrokerError', () => {
  it('should create error with correct properties', () => {
    const error = new BrokerError(
      BrokerErrorCode.INSUFFICIENT_FUNDS,
      'Not enough buying power',
      'alpaca'
    );

    expect(error.code).toBe(BrokerErrorCode.INSUFFICIENT_FUNDS);
    expect(error.message).toBe('Not enough buying power');
    expect(error.brokerType).toBe('alpaca');
    expect(error.retryable).toBe(false);
  });

  it('should generate user-friendly messages', () => {
    const error = new BrokerError(
      BrokerErrorCode.RATE_LIMIT_EXCEEDED,
      'Too many requests',
      'tradier',
      undefined,
      true,
      5000
    );

    const userMessage = error.toUserMessage();
    expect(userMessage).toContain('Rate limit exceeded');
    expect(userMessage).toContain('5 seconds');
  });
});
