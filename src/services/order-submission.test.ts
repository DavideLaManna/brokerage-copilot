/**
 * Tests for Order Submission Service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import {
  OrderSubmissionService,
  createOrderSubmissionService,
  submitOrder,
  submitOrders,
  DEFAULT_SUBMISSION_CONFIG,
  type OrderSubmissionResult,
  type BatchSubmissionResult,
} from './order-submission.js';
import {
  OrderSubmissionStore,
  createOrderSubmission,
} from '../storage/order-submissions.js';
import type { BrokerAdapter, Order, OrderRequest, AccountSummary, Position, Quote, OptionChain, HistoricalBarsResponse } from '../types/broker.js';
import { BrokerError, BrokerErrorCode, RateLimitError } from '../types/errors.js';
import type { DraftOrder, BuildDraftOrdersResult } from './draft-order-builder.js';

// Test storage path
const TEST_STORAGE_PATH = '.test-order-submission-service';
const TEST_PASSWORD = 'test-password-123';

// Mock adapter
function createMockAdapter(overrides: Partial<BrokerAdapter> = {}): BrokerAdapter {
  return {
    brokerType: 'tradier',
    brokerName: 'Tradier',
    getAccountSummary: vi.fn().mockResolvedValue({ netLiquidation: 100000 } as AccountSummary),
    getPositions: vi.fn().mockResolvedValue([] as Position[]),
    getOpenOrders: vi.fn().mockResolvedValue([] as Order[]),
    getOrder: vi.fn().mockResolvedValue(null),
    placeOrder: vi.fn().mockImplementation(async (order: OrderRequest, idempotencyKey: string) => {
      return {
        id: 'BROKER-ORDER-' + idempotencyKey.slice(-8),
        clientOrderId: idempotencyKey,
        symbol: order.symbol,
        assetClass: order.assetClass,
        side: order.side,
        orderType: order.orderType,
        timeInForce: order.timeInForce,
        quantity: order.quantity,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
      } as Order;
    }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getQuote: vi.fn().mockResolvedValue({} as Quote),
    getOptionChain: vi.fn().mockResolvedValue({} as OptionChain),
    getHistoricalBars: vi.fn().mockResolvedValue({} as HistoricalBarsResponse),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn(),
    ...overrides,
  } as BrokerAdapter;
}

// Create a mock draft order
function createMockDraftOrder(overrides: Partial<DraftOrder> = {}): DraftOrder {
  return {
    orderRequest: {
      symbol: 'AAPL240216C00185000',
      assetClass: 'option',
      side: 'buy',
      orderType: 'limit',
      timeInForce: 'day',
      quantity: 1,
      limitPrice: 3.5,
      optionDetails: {
        underlying: 'AAPL',
        strike: 185,
        expiration: new Date('2024-02-16'),
        optionType: 'call',
      },
    },
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    proposalId: undefined,
    legIndex: 0,
    contractInfo: {
      underlying: 'AAPL',
      strike: 185,
      expiration: new Date('2024-02-16'),
      optionType: 'call',
      side: 'buy',
      quantity: 1,
      targetPrice: 3.5,
    },
    estimatedCost: 350,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('OrderSubmissionService', () => {
  let store: OrderSubmissionStore;
  let adapter: BrokerAdapter;
  let service: OrderSubmissionService;
  const testAccountId = 'test-account-123';

  beforeEach(async () => {
    // Clean up test storage
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }

    store = new OrderSubmissionStore({
      masterPassword: TEST_PASSWORD,
      storagePath: TEST_STORAGE_PATH,
    });
    await store.initialize();

    adapter = createMockAdapter();
    service = new OrderSubmissionService(adapter, store, testAccountId);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }
    vi.clearAllMocks();
  });

  describe('DEFAULT_SUBMISSION_CONFIG', () => {
    it('has sensible defaults', () => {
      expect(DEFAULT_SUBMISSION_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_SUBMISSION_CONFIG.baseRetryDelayMs).toBe(1000);
      expect(DEFAULT_SUBMISSION_CONFIG.maxRetryDelayMs).toBe(30000);
      expect(DEFAULT_SUBMISSION_CONFIG.useJitter).toBe(true);
    });
  });

  describe('submitOrder', () => {
    it('successfully submits a new order', async () => {
      const draftOrder = createMockDraftOrder();

      const result = await service.submitOrder(draftOrder);

      expect(result.success).toBe(true);
      expect(result.orderId).toBeDefined();
      expect(result.orderId).toContain('BROKER-ORDER-');
      expect(result.retryCount).toBe(0);
      expect(adapter.placeOrder).toHaveBeenCalledOnce();
    });

    it('stores submission record', async () => {
      const draftOrder = createMockDraftOrder();

      await service.submitOrder(draftOrder);

      const submission = await store.getSubmission(testAccountId, draftOrder.idempotencyKey);
      expect(submission).toBeDefined();
      expect(submission?.status).toBe('submitted');
      expect(submission?.brokerOrderId).toBeDefined();
    });

    it('returns existing result for duplicate idempotency key', async () => {
      const draftOrder = createMockDraftOrder();

      // First submission
      const result1 = await service.submitOrder(draftOrder);
      expect(result1.success).toBe(true);
      expect(adapter.placeOrder).toHaveBeenCalledOnce();

      // Second submission with same key
      const result2 = await service.submitOrder(draftOrder);
      expect(result2.success).toBe(true);
      expect(result2.isDuplicate).toBe(true);
      expect(result2.orderId).toBe(result1.orderId);
      // Should NOT call placeOrder again
      expect(adapter.placeOrder).toHaveBeenCalledOnce();
    });

    it('handles broker rejection', async () => {
      adapter = createMockAdapter({
        placeOrder: vi.fn().mockRejectedValue(
          new BrokerError(
            BrokerErrorCode.INSUFFICIENT_FUNDS,
            'Insufficient buying power',
            'tradier'
          )
        ),
      });
      service = new OrderSubmissionService(adapter, store, testAccountId);

      const draftOrder = createMockDraftOrder();
      const result = await service.submitOrder(draftOrder);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(BrokerErrorCode.INSUFFICIENT_FUNDS);
      expect(result.errorMessage).toContain('buying power');

      // Should mark as rejected
      const submission = await store.getSubmission(testAccountId, draftOrder.idempotencyKey);
      expect(submission?.status).toBe('rejected');
    });

    it('retries on rate limit error', async () => {
      let callCount = 0;
      adapter = createMockAdapter({
        placeOrder: vi.fn().mockImplementation(async (order: OrderRequest, idempotencyKey: string) => {
          callCount++;
          if (callCount < 3) {
            throw new RateLimitError('Rate limit exceeded', 'tradier', 1000);
          }
          return {
            id: 'BROKER-ORDER-' + idempotencyKey.slice(-8),
            symbol: order.symbol,
            side: order.side,
            status: 'open',
          } as Order;
        }),
      });
      service = new OrderSubmissionService(adapter, store, testAccountId, {
        maxRetries: 3,
        baseRetryDelayMs: 10, // Fast for testing
        useJitter: false,
      });

      const draftOrder = createMockDraftOrder();
      const result = await service.submitOrder(draftOrder);

      expect(result.success).toBe(true);
      expect(callCount).toBe(3);
      expect(result.retryCount).toBe(2);
    });

    it('fails after max retries', async () => {
      adapter = createMockAdapter({
        placeOrder: vi.fn().mockRejectedValue(
          new RateLimitError('Rate limit exceeded', 'tradier', 1000)
        ),
      });
      service = new OrderSubmissionService(adapter, store, testAccountId, {
        maxRetries: 2,
        baseRetryDelayMs: 10,
        useJitter: false,
      });

      const draftOrder = createMockDraftOrder();
      const result = await service.submitOrder(draftOrder);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(BrokerErrorCode.RATE_LIMIT_EXCEEDED);
      expect(adapter.placeOrder).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('retries on connection timeout', async () => {
      let callCount = 0;
      adapter = createMockAdapter({
        placeOrder: vi.fn().mockImplementation(async (order: OrderRequest, idempotencyKey: string) => {
          callCount++;
          if (callCount === 1) {
            throw new BrokerError(
              BrokerErrorCode.CONNECTION_TIMEOUT,
              'Connection timed out',
              'tradier',
              undefined,
              true
            );
          }
          return {
            id: 'BROKER-ORDER-' + idempotencyKey.slice(-8),
            symbol: order.symbol,
            side: order.side,
            status: 'open',
          } as Order;
        }),
      });
      service = new OrderSubmissionService(adapter, store, testAccountId, {
        baseRetryDelayMs: 10,
        useJitter: false,
      });

      const draftOrder = createMockDraftOrder();
      const result = await service.submitOrder(draftOrder);

      expect(result.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it('does not retry on invalid order error', async () => {
      adapter = createMockAdapter({
        placeOrder: vi.fn().mockRejectedValue(
          new BrokerError(
            BrokerErrorCode.INVALID_ORDER,
            'Invalid order parameters',
            'tradier'
          )
        ),
      });
      service = new OrderSubmissionService(adapter, store, testAccountId);

      const draftOrder = createMockDraftOrder();
      const result = await service.submitOrder(draftOrder);

      expect(result.success).toBe(false);
      expect(adapter.placeOrder).toHaveBeenCalledOnce(); // No retries
    });
  });

  describe('submitOrders (batch)', () => {
    it('submits multiple orders successfully', async () => {
      const draftOrdersResult: BuildDraftOrdersResult = {
        orders: [
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440001' }),
          createMockDraftOrder({
            idempotencyKey: '550e8400-e29b-41d4-a716-446655440002',
            orderRequest: {
              ...createMockDraftOrder().orderRequest,
              side: 'sell',
            },
            contractInfo: {
              ...createMockDraftOrder().contractInfo,
              side: 'sell',
            },
          }),
        ],
        warnings: [],
        totalEstimatedCost: 0, // spread
        correlationId: '550e8400-e29b-41d4-a716-446655440099',
        proposalId: '550e8400-e29b-41d4-a716-446655440088',
      };

      const result = await service.submitOrders(draftOrdersResult);

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2);
      expect(result.summary.total).toBe(2);
      expect(result.summary.succeeded).toBe(2);
      expect(result.summary.failed).toBe(0);
      expect(result.correlationId).toBe(draftOrdersResult.correlationId);
      expect(result.proposalId).toBe(draftOrdersResult.proposalId);
    });

    it('handles partial failures', async () => {
      let callCount = 0;
      adapter = createMockAdapter({
        placeOrder: vi.fn().mockImplementation(async (order: OrderRequest, idempotencyKey: string) => {
          callCount++;
          if (callCount === 2) {
            throw new BrokerError(
              BrokerErrorCode.INSUFFICIENT_FUNDS,
              'Insufficient funds',
              'tradier'
            );
          }
          return {
            id: 'BROKER-ORDER-' + idempotencyKey.slice(-8),
            symbol: order.symbol,
            side: order.side,
            status: 'open',
          } as Order;
        }),
      });
      service = new OrderSubmissionService(adapter, store, testAccountId);

      const draftOrdersResult: BuildDraftOrdersResult = {
        orders: [
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440001' }),
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440002' }),
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440003' }),
        ],
        warnings: [],
        totalEstimatedCost: 1050,
        correlationId: '550e8400-e29b-41d4-a716-446655440099',
      };

      const result = await service.submitOrders(draftOrdersResult);

      expect(result.success).toBe(false);
      expect(result.summary.succeeded).toBe(2);
      expect(result.summary.failed).toBe(1);
      expect(result.results[0]!.success).toBe(true);
      expect(result.results[1]!.success).toBe(false);
      expect(result.results[2]!.success).toBe(true);
    });

    it('tracks duplicates in batch', async () => {
      const draftOrdersResult: BuildDraftOrdersResult = {
        orders: [
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440001' }),
        ],
        warnings: [],
        totalEstimatedCost: 350,
        correlationId: '550e8400-e29b-41d4-a716-446655440099',
      };

      // First submission
      await service.submitOrders(draftOrdersResult);

      // Second submission
      const result = await service.submitOrders(draftOrdersResult);

      expect(result.success).toBe(true);
      expect(result.summary.duplicates).toBe(1);
      expect(result.results[0]!.isDuplicate).toBe(true);
    });

    it('stores correlation ID with each submission', async () => {
      const correlationId = '550e8400-e29b-41d4-a716-446655440099';
      const draftOrdersResult: BuildDraftOrdersResult = {
        orders: [
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440001' }),
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440002' }),
        ],
        warnings: [],
        totalEstimatedCost: 700,
        correlationId,
      };

      await service.submitOrders(draftOrdersResult);

      const correlated = await store.getSubmissionsByCorrelationId(testAccountId, correlationId);
      expect(correlated.length).toBe(2);
    });
  });

  describe('getSubmissionStatus', () => {
    it('returns submission status', async () => {
      const draftOrder = createMockDraftOrder();
      await service.submitOrder(draftOrder);

      const status = await service.getSubmissionStatus(draftOrder.idempotencyKey);

      expect(status).toBeDefined();
      expect(status?.status).toBe('submitted');
    });

    it('returns null for unknown key', async () => {
      const status = await service.getSubmissionStatus('550e8400-e29b-41d4-a716-446655440999');
      expect(status).toBeNull();
    });
  });

  describe('getCorrelatedSubmissions', () => {
    it('returns all submissions with same correlation ID', async () => {
      const correlationId = '550e8400-e29b-41d4-a716-446655440099';
      const draftOrdersResult: BuildDraftOrdersResult = {
        orders: [
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440001' }),
          createMockDraftOrder({ idempotencyKey: '550e8400-e29b-41d4-a716-446655440002' }),
        ],
        warnings: [],
        totalEstimatedCost: 700,
        correlationId,
      };

      await service.submitOrders(draftOrdersResult);

      const correlated = await service.getCorrelatedSubmissions(correlationId);
      expect(correlated.length).toBe(2);
    });
  });
});

describe('standalone functions', () => {
  let store: OrderSubmissionStore;
  let adapter: BrokerAdapter;
  const testAccountId = 'test-account-123';

  beforeEach(async () => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }

    store = new OrderSubmissionStore({
      masterPassword: TEST_PASSWORD,
      storagePath: TEST_STORAGE_PATH,
    });
    await store.initialize();

    adapter = createMockAdapter();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }
  });

  describe('createOrderSubmissionService', () => {
    it('creates service instance', () => {
      const service = createOrderSubmissionService(adapter, store, testAccountId);
      expect(service).toBeInstanceOf(OrderSubmissionService);
    });
  });

  describe('submitOrder (standalone)', () => {
    it('submits order', async () => {
      const draftOrder = createMockDraftOrder();
      const result = await submitOrder(adapter, store, testAccountId, draftOrder);

      expect(result.success).toBe(true);
    });
  });

  describe('submitOrders (standalone)', () => {
    it('submits multiple orders', async () => {
      const draftOrdersResult: BuildDraftOrdersResult = {
        orders: [createMockDraftOrder()],
        warnings: [],
        totalEstimatedCost: 350,
        correlationId: '550e8400-e29b-41d4-a716-446655440099',
      };

      const result = await submitOrders(adapter, store, testAccountId, draftOrdersResult);

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(1);
    });
  });
});

describe('error handling', () => {
  let store: OrderSubmissionStore;
  let adapter: BrokerAdapter;
  let service: OrderSubmissionService;
  const testAccountId = 'test-account-123';

  beforeEach(async () => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }

    store = new OrderSubmissionStore({
      masterPassword: TEST_PASSWORD,
      storagePath: TEST_STORAGE_PATH,
    });
    await store.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }
    vi.clearAllMocks();
  });

  it('handles market closed error', async () => {
    adapter = createMockAdapter({
      placeOrder: vi.fn().mockRejectedValue(
        new BrokerError(BrokerErrorCode.MARKET_CLOSED, 'Market is closed', 'tradier')
      ),
    });
    service = new OrderSubmissionService(adapter, store, testAccountId);

    const result = await service.submitOrder(createMockDraftOrder());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(BrokerErrorCode.MARKET_CLOSED);

    const submission = await store.getSubmission(testAccountId, '550e8400-e29b-41d4-a716-446655440000');
    expect(submission?.status).toBe('rejected');
  });

  it('handles symbol not tradeable error', async () => {
    adapter = createMockAdapter({
      placeOrder: vi.fn().mockRejectedValue(
        new BrokerError(BrokerErrorCode.SYMBOL_NOT_TRADEABLE, 'Symbol not tradeable', 'tradier')
      ),
    });
    service = new OrderSubmissionService(adapter, store, testAccountId);

    const result = await service.submitOrder(createMockDraftOrder());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(BrokerErrorCode.SYMBOL_NOT_TRADEABLE);
  });

  it('handles duplicate order error from broker', async () => {
    adapter = createMockAdapter({
      placeOrder: vi.fn().mockRejectedValue(
        new BrokerError(BrokerErrorCode.DUPLICATE_ORDER, 'Duplicate order detected', 'tradier')
      ),
    });
    service = new OrderSubmissionService(adapter, store, testAccountId);

    const result = await service.submitOrder(createMockDraftOrder());

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(BrokerErrorCode.DUPLICATE_ORDER);
  });

  it('handles generic errors', async () => {
    adapter = createMockAdapter({
      placeOrder: vi.fn().mockRejectedValue(new Error('Something went wrong')),
    });
    service = new OrderSubmissionService(adapter, store, testAccountId);

    const result = await service.submitOrder(createMockDraftOrder());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Something went wrong');
    expect(result.errorCode).toBe('UNKNOWN_ERROR');
  });

  it('handles network errors with retry', async () => {
    let callCount = 0;
    adapter = createMockAdapter({
      placeOrder: vi.fn().mockImplementation(async (order: OrderRequest, idempotencyKey: string) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('ECONNRESET');
        }
        return {
          id: 'BROKER-ORDER-' + idempotencyKey.slice(-8),
          symbol: order.symbol,
          side: order.side,
          status: 'open',
        } as Order;
      }),
    });
    service = new OrderSubmissionService(adapter, store, testAccountId, {
      baseRetryDelayMs: 10,
      useJitter: false,
    });

    const result = await service.submitOrder(createMockDraftOrder());

    expect(result.success).toBe(true);
    expect(callCount).toBe(2);
  });
});

describe('idempotency scenarios', () => {
  let store: OrderSubmissionStore;
  let adapter: BrokerAdapter;
  let service: OrderSubmissionService;
  const testAccountId = 'test-account-123';

  beforeEach(async () => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }

    store = new OrderSubmissionStore({
      masterPassword: TEST_PASSWORD,
      storagePath: TEST_STORAGE_PATH,
    });
    await store.initialize();

    adapter = createMockAdapter();
    service = new OrderSubmissionService(adapter, store, testAccountId);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }
    vi.clearAllMocks();
  });

  it('returns previous failure for failed submission', async () => {
    // First, create a failed submission
    adapter = createMockAdapter({
      placeOrder: vi.fn().mockRejectedValue(
        new BrokerError(BrokerErrorCode.INSUFFICIENT_FUNDS, 'Insufficient funds', 'tradier')
      ),
    });
    service = new OrderSubmissionService(adapter, store, testAccountId);

    const draftOrder = createMockDraftOrder();
    const result1 = await service.submitOrder(draftOrder);
    expect(result1.success).toBe(false);

    // Now create new service with working adapter
    adapter = createMockAdapter();
    service = new OrderSubmissionService(adapter, store, testAccountId);

    // Retry with same key should return the previous failure
    const result2 = await service.submitOrder(draftOrder);
    expect(result2.success).toBe(false);
    expect(result2.isDuplicate).toBe(true);
    expect(result2.errorCode).toBe(BrokerErrorCode.INSUFFICIENT_FUNDS);
    expect(adapter.placeOrder).not.toHaveBeenCalled(); // Should not call broker
  });

  it('returns success for previously successful submission', async () => {
    const draftOrder = createMockDraftOrder();

    // First submission succeeds
    const result1 = await service.submitOrder(draftOrder);
    expect(result1.success).toBe(true);
    const orderId = result1.orderId;

    // Clear the mock to verify no new call
    vi.clearAllMocks();

    // Retry returns the same success
    const result2 = await service.submitOrder(draftOrder);
    expect(result2.success).toBe(true);
    expect(result2.isDuplicate).toBe(true);
    expect(result2.orderId).toBe(orderId);
    expect(adapter.placeOrder).not.toHaveBeenCalled();
  });
});
