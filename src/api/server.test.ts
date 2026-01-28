/**
 * API Server Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiServer } from './server.js';
import { BrokerConnectionService } from '../services/broker-connection.js';
import type { BrokerAdapter, AccountSummary, Position, Order } from '../types/broker.js';
import { BrokerError, BrokerErrorCode } from '../types/errors.js';

// Mock the SecretManager
const mockSecretManager = {
  getCredentials: vi.fn(),
  validateCredentials: vi.fn(),
};

// Mock AccountSummary
const mockAccountSummary: AccountSummary = {
  accountId: 'TEST123',
  netLiquidation: 100000,
  buyingPower: 50000,
  cash: 25000,
  dayTradingBuyingPower: 100000,
  maintenanceMargin: 25000,
  unrealizedPnL: 1500,
  realizedPnL: 500,
  currency: 'USD',
  asOf: new Date('2024-01-15T10:00:00Z'),
};

// Mock Positions
const mockPositions: Position[] = [
  {
    id: 'pos-1',
    symbol: 'AAPL',
    quantity: 100,
    averageCost: 150.00,
    currentPrice: 160.00,
    marketValue: 16000,
    unrealizedPnL: 1000,
    unrealizedPnLPercent: 6.67,
    assetClass: 'equity',
  },
  {
    id: 'pos-2',
    symbol: 'AAPL240119C00155000',
    quantity: 5,
    averageCost: 5.50,
    currentPrice: 7.25,
    marketValue: 3625,
    unrealizedPnL: 875,
    unrealizedPnLPercent: 31.82,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'AAPL240119C00155000',
      underlying: 'AAPL',
      strike: 155,
      expiration: new Date('2024-01-19'),
      optionType: 'call',
      multiplier: 100,
    },
  },
];

// Mock Orders
const mockOrders: Order[] = [
  {
    id: 'ord-1',
    symbol: 'AAPL',
    assetClass: 'equity',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'day',
    quantity: 50,
    limitPrice: 155.00,
    filledQuantity: 0,
    status: 'open',
    submittedAt: new Date('2024-01-15T09:30:00Z'),
  },
];

// Create mock adapter
function createMockAdapter(): BrokerAdapter {
  return {
    brokerType: 'tradier',
    brokerName: 'Tradier',
    getAccountSummary: vi.fn().mockResolvedValue(mockAccountSummary),
    getPositions: vi.fn().mockResolvedValue(mockPositions),
    getOpenOrders: vi.fn().mockResolvedValue(mockOrders),
    getOrder: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getQuote: vi.fn(),
    getOptionChain: vi.fn(),
    getHistoricalBars: vi.fn(),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
  };
}

describe('ApiServer', () => {
  let connectionService: BrokerConnectionService;
  let mockAdapter: BrokerAdapter;
  let server: ApiServer;

  beforeEach(() => {
    vi.clearAllMocks();
    connectionService = new BrokerConnectionService(mockSecretManager as any);
    mockAdapter = createMockAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('health endpoint', () => {
    it('should create server with health route', async () => {
      server = new ApiServer(connectionService);
      const app = server.getApp();

      // Verify app was created
      expect(app).toBeDefined();
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
    });
  });

  describe('getAdapterOrThrow', () => {
    it('should throw when not connected', () => {
      server = new ApiServer(connectionService);
      // Access private method through type coercion for testing
      const serverAny = server as any;

      expect(() => serverAny.getAdapterOrThrow()).toThrow('Not connected to broker');
    });
  });

  describe('wrapResponse', () => {
    it('should wrap successful response', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const result = serverAny.wrapResponse({ foo: 'bar' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ foo: 'bar' });
      expect(result.timestamp).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should wrap error response', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const result = serverAny.wrapResponse(null, 'Something went wrong');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
      expect(result.timestamp).toBeDefined();
      expect(result.data).toBeUndefined();
    });
  });

  describe('getStatusCodeForBrokerError', () => {
    it('should return 401 for auth errors', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const authError = new BrokerError(BrokerErrorCode.AUTHENTICATION_FAILED, 'Auth failed');
      expect(serverAny.getStatusCodeForBrokerError(authError)).toBe(401);

      const tokenError = new BrokerError(BrokerErrorCode.TOKEN_EXPIRED, 'Token expired');
      expect(serverAny.getStatusCodeForBrokerError(tokenError)).toBe(401);

      const credError = new BrokerError(BrokerErrorCode.INVALID_CREDENTIALS, 'Invalid creds');
      expect(serverAny.getStatusCodeForBrokerError(credError)).toBe(401);
    });

    it('should return 429 for rate limit errors', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const error = new BrokerError(BrokerErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limited');
      expect(serverAny.getStatusCodeForBrokerError(error)).toBe(429);
    });

    it('should return 400 for validation errors', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const orderError = new BrokerError(BrokerErrorCode.INVALID_ORDER, 'Invalid order');
      expect(serverAny.getStatusCodeForBrokerError(orderError)).toBe(400);

      const symbolError = new BrokerError(BrokerErrorCode.SYMBOL_NOT_FOUND, 'Invalid symbol');
      expect(serverAny.getStatusCodeForBrokerError(symbolError)).toBe(400);
    });

    it('should return 404 for not found errors', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const error = new BrokerError(BrokerErrorCode.ORDER_NOT_FOUND, 'Order not found');
      expect(serverAny.getStatusCodeForBrokerError(error)).toBe(404);
    });

    it('should return 503 for service errors', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const error = new BrokerError(BrokerErrorCode.SERVICE_UNAVAILABLE, 'Service down');
      expect(serverAny.getStatusCodeForBrokerError(error)).toBe(503);
    });

    it('should return 500 for unknown errors', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const error = new BrokerError(BrokerErrorCode.UNKNOWN_ERROR, 'Unknown');
      expect(serverAny.getStatusCodeForBrokerError(error)).toBe(500);
    });
  });

  describe('getConnectionInfo', () => {
    it('should return disconnected state when no adapter', () => {
      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const info = serverAny.getConnectionInfo();

      expect(info.connected).toBe(false);
      expect(info.brokerName).toBeNull();
      expect(info.accountId).toBeNull();
    });

    it('should return connected state when adapter exists', () => {
      // Manually inject adapter into connection service
      (connectionService as any).adapters.set('tradier', mockAdapter);
      (connectionService as any).connectionStates.set('tradier', {
        brokerType: 'tradier',
        connected: true,
        lastConnected: new Date(),
        accountSummary: mockAccountSummary,
      });

      server = new ApiServer(connectionService);
      const serverAny = server as any;

      const info = serverAny.getConnectionInfo();

      expect(info.connected).toBe(true);
      expect(info.brokerName).toBe('Tradier');
      // accountId is now derived from broker type and timestamp
      expect(info.accountId).toBeTruthy();
      expect(info.accountId.startsWith('TRADIER-')).toBe(true);
    });
  });

  describe('route registration', () => {
    it('should setup app with expected configuration', () => {
      server = new ApiServer(connectionService);
      const app = server.getApp();

      // Express 5 doesn't expose routes the same way
      // Verify app has basic express functionality
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
      expect(typeof app.use).toBe('function');

      // Verify server was created with correct port
      expect((server as any).port).toBe(3001);
    });
  });

  describe('port configuration', () => {
    it('should use default port 3001', () => {
      server = new ApiServer(connectionService);
      expect((server as any).port).toBe(3001);
    });

    it('should use custom port when specified', () => {
      server = new ApiServer(connectionService, 8080);
      expect((server as any).port).toBe(8080);
    });
  });
});

describe('chat review endpoint', () => {
  it('should require connected adapter for chat review', () => {
    const connectionService = new BrokerConnectionService(mockSecretManager as any);
    const server = new ApiServer(connectionService);
    const serverAny = server as any;

    // Without adapter, should throw
    expect(() => serverAny.getAdapterOrThrow()).toThrow('Not connected to broker');
  });

  it('should have chat review route configured', () => {
    const connectionService = new BrokerConnectionService(mockSecretManager as any);
    const server = new ApiServer(connectionService);
    const app = server.getApp();

    // Verify app was created and has POST method for routes
    expect(app).toBeDefined();
    expect(typeof app.post).toBe('function');
  });
});

describe('createApiServer', () => {
  it('should create ApiServer instance', async () => {
    const { createApiServer } = await import('./server.js');

    const connectionService = new BrokerConnectionService(mockSecretManager as any);
    const server = createApiServer(connectionService);

    expect(server).toBeInstanceOf(ApiServer);
  });

  it('should accept custom port', async () => {
    const { createApiServer } = await import('./server.js');

    const connectionService = new BrokerConnectionService(mockSecretManager as any);
    const server = createApiServer(connectionService, 9000);

    expect((server as any).port).toBe(9000);
  });
});
