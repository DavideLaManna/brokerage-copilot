/**
 * Tests for Order Submission Storage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  OrderSubmissionStore,
  createOrderSubmission,
  OrderSubmissionSchema,
  type OrderSubmission,
} from './order-submissions.js';

// Test storage path
const TEST_STORAGE_PATH = '.test-order-submissions';
const TEST_PASSWORD = 'test-password-123';

describe('OrderSubmissionStore', () => {
  let store: OrderSubmissionStore;
  const testAccountId = 'test-account-123';

  beforeEach(async () => {
    // Clean up test storage before each test
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
    // Clean up test storage after each test
    if (fs.existsSync(TEST_STORAGE_PATH)) {
      fs.rmSync(TEST_STORAGE_PATH, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('throws error for short password', () => {
      expect(() => new OrderSubmissionStore({ masterPassword: 'short' })).toThrow(
        'Master password must be at least 8 characters'
      );
    });

    it('accepts valid password', () => {
      expect(() => new OrderSubmissionStore({ masterPassword: TEST_PASSWORD })).not.toThrow();
    });
  });

  describe('createOrderSubmission', () => {
    it('creates valid submission record', () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        correlationId: '550e8400-e29b-41d4-a716-446655440001',
        orderRequest: {
          symbol: 'AAPL240216C00185000',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
          limitPrice: 3.5,
        },
      });

      expect(submission.status).toBe('pending');
      expect(submission.retryCount).toBe(0);
      expect(submission.submittedAt).toBeDefined();
      expect(submission.updatedAt).toBeDefined();
    });

    it('validates with Zod schema', () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 10,
          orderType: 'market',
        },
      });

      const result = OrderSubmissionSchema.safeParse(submission);
      expect(result.success).toBe(true);
    });
  });

  describe('storeSubmission', () => {
    it('stores a new submission', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
          limitPrice: 150,
        },
      });

      await store.storeSubmission(submission);

      const retrieved = await store.getSubmission(testAccountId, submission.idempotencyKey);
      expect(retrieved).toBeDefined();
      expect(retrieved?.idempotencyKey).toBe(submission.idempotencyKey);
      expect(retrieved?.status).toBe('pending');
    });

    it('throws error for duplicate idempotency key', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
      });

      await store.storeSubmission(submission);

      // Try to store again with same key
      await expect(store.storeSubmission(submission)).rejects.toThrow('Idempotency key already exists');
    });

    it('throws error for invalid submission', async () => {
      const invalidSubmission = {
        idempotencyKey: 'not-a-uuid',
        accountId: testAccountId,
        status: 'pending',
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retryCount: 0,
      } as OrderSubmission;

      await expect(store.storeSubmission(invalidSubmission)).rejects.toThrow('Invalid submission');
    });
  });

  describe('hasIdempotencyKey', () => {
    it('returns true for existing key', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
      });

      await store.storeSubmission(submission);

      const exists = await store.hasIdempotencyKey(testAccountId, submission.idempotencyKey);
      expect(exists).toBe(true);
    });

    it('returns false for non-existing key', async () => {
      const exists = await store.hasIdempotencyKey(testAccountId, '550e8400-e29b-41d4-a716-446655440000');
      expect(exists).toBe(false);
    });
  });

  describe('updateSubmission', () => {
    it('updates existing submission', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
      });

      await store.storeSubmission(submission);

      const updated = await store.updateSubmission(testAccountId, submission.idempotencyKey, {
        status: 'submitted',
        brokerOrderId: 'BROKER-123',
      });

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('submitted');
      expect(updated?.brokerOrderId).toBe('BROKER-123');
    });

    it('returns null for non-existing submission', async () => {
      const result = await store.updateSubmission(testAccountId, '550e8400-e29b-41d4-a716-446655440000', {
        status: 'submitted',
      });

      expect(result).toBeNull();
    });
  });

  describe('markSubmitted', () => {
    it('marks submission as submitted with broker order ID', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
      });

      await store.storeSubmission(submission);

      const updated = await store.markSubmitted(testAccountId, submission.idempotencyKey, 'BROKER-ORDER-123');

      expect(updated?.status).toBe('submitted');
      expect(updated?.brokerOrderId).toBe('BROKER-ORDER-123');
      expect(updated?.confirmedAt).toBeDefined();
    });
  });

  describe('markFailed', () => {
    it('marks submission as failed with error message', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
      });

      await store.storeSubmission(submission);

      const updated = await store.markFailed(
        testAccountId,
        submission.idempotencyKey,
        'Insufficient funds',
        'ORDER_001'
      );

      expect(updated?.status).toBe('failed');
      expect(updated?.errorMessage).toBe('Insufficient funds');
      expect(updated?.errorCode).toBe('ORDER_001');
    });
  });

  describe('markRejected', () => {
    it('marks submission as rejected', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
      });

      await store.storeSubmission(submission);

      const updated = await store.markRejected(
        testAccountId,
        submission.idempotencyKey,
        'Market closed',
        'ORDER_007'
      );

      expect(updated?.status).toBe('rejected');
      expect(updated?.errorMessage).toBe('Market closed');
    });
  });

  describe('incrementRetryCount', () => {
    it('increments retry count', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 1,
          orderType: 'limit',
        },
      });

      await store.storeSubmission(submission);
      expect(submission.retryCount).toBe(0);

      let updated = await store.incrementRetryCount(testAccountId, submission.idempotencyKey);
      expect(updated?.retryCount).toBe(1);

      updated = await store.incrementRetryCount(testAccountId, submission.idempotencyKey);
      expect(updated?.retryCount).toBe(2);
    });
  });

  describe('getAccountSubmissions', () => {
    it('returns all submissions for account', async () => {
      for (let i = 0; i < 3; i++) {
        const submission = createOrderSubmission({
          idempotencyKey: `550e8400-e29b-41d4-a716-44665544000${i}`,
          accountId: testAccountId,
          orderRequest: {
            symbol: 'AAPL',
            side: 'buy',
            quantity: 1,
            orderType: 'limit',
          },
        });
        await store.storeSubmission(submission);
      }

      const submissions = await store.getAccountSubmissions(testAccountId);
      expect(submissions.length).toBe(3);
    });

    it('filters by status', async () => {
      const submission1 = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
      });
      const submission2 = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
        accountId: testAccountId,
        orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
      });

      await store.storeSubmission(submission1);
      await store.storeSubmission(submission2);
      await store.markSubmitted(testAccountId, submission1.idempotencyKey, 'BROKER-123');

      const pendingSubmissions = await store.getAccountSubmissions(testAccountId, { status: 'pending' });
      expect(pendingSubmissions.length).toBe(1);

      const submittedSubmissions = await store.getAccountSubmissions(testAccountId, { status: 'submitted' });
      expect(submittedSubmissions.length).toBe(1);
    });

    it('filters by correlation ID', async () => {
      const correlationId = '550e8400-e29b-41d4-a716-446655440099';

      const submission1 = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        correlationId,
        orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
      });
      const submission2 = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
        accountId: testAccountId,
        correlationId,
        orderRequest: { symbol: 'AAPL', side: 'sell', quantity: 1, orderType: 'limit' },
      });
      const submission3 = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440002',
        accountId: testAccountId,
        orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
      });

      await store.storeSubmission(submission1);
      await store.storeSubmission(submission2);
      await store.storeSubmission(submission3);

      const correlated = await store.getAccountSubmissions(testAccountId, { correlationId });
      expect(correlated.length).toBe(2);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        const submission = createOrderSubmission({
          idempotencyKey: `550e8400-e29b-41d4-a716-44665544000${i}`,
          accountId: testAccountId,
          orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
        });
        await store.storeSubmission(submission);
      }

      const page1 = await store.getAccountSubmissions(testAccountId, { limit: 2 });
      expect(page1.length).toBe(2);

      const page2 = await store.getAccountSubmissions(testAccountId, { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);
    });
  });

  describe('persistence', () => {
    it('persists submissions to disk', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
      });

      await store.storeSubmission(submission);

      // Create new store instance
      const newStore = new OrderSubmissionStore({
        masterPassword: TEST_PASSWORD,
        storagePath: TEST_STORAGE_PATH,
      });
      await newStore.initialize();

      const retrieved = await newStore.getSubmission(testAccountId, submission.idempotencyKey);
      expect(retrieved).toBeDefined();
      expect(retrieved?.idempotencyKey).toBe(submission.idempotencyKey);
    });
  });

  describe('deleteSubmission', () => {
    it('deletes existing submission', async () => {
      const submission = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: testAccountId,
        orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
      });

      await store.storeSubmission(submission);
      expect(await store.hasIdempotencyKey(testAccountId, submission.idempotencyKey)).toBe(true);

      const deleted = await store.deleteSubmission(testAccountId, submission.idempotencyKey);
      expect(deleted).toBe(true);
      expect(await store.hasIdempotencyKey(testAccountId, submission.idempotencyKey)).toBe(false);
    });

    it('returns false for non-existing submission', async () => {
      const deleted = await store.deleteSubmission(testAccountId, '550e8400-e29b-41d4-a716-446655440000');
      expect(deleted).toBe(false);
    });
  });

  describe('clearAccount', () => {
    it('clears all submissions for account', async () => {
      for (let i = 0; i < 3; i++) {
        const submission = createOrderSubmission({
          idempotencyKey: `550e8400-e29b-41d4-a716-44665544000${i}`,
          accountId: testAccountId,
          orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
        });
        await store.storeSubmission(submission);
      }

      const before = await store.getAccountSubmissions(testAccountId);
      expect(before.length).toBe(3);

      await store.clearAccount(testAccountId);

      const after = await store.getAccountSubmissions(testAccountId);
      expect(after.length).toBe(0);
    });
  });

  describe('multi-account isolation', () => {
    it('isolates submissions by account', async () => {
      const account1 = 'account-1';
      const account2 = 'account-2';

      const submission1 = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: account1,
        orderRequest: { symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'limit' },
      });
      const submission2 = createOrderSubmission({
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
        accountId: account2,
        orderRequest: { symbol: 'MSFT', side: 'buy', quantity: 1, orderType: 'limit' },
      });

      await store.storeSubmission(submission1);
      await store.storeSubmission(submission2);

      const account1Submissions = await store.getAccountSubmissions(account1);
      expect(account1Submissions.length).toBe(1);
      expect(account1Submissions[0]?.orderRequest.symbol).toBe('AAPL');

      const account2Submissions = await store.getAccountSubmissions(account2);
      expect(account2Submissions.length).toBe(1);
      expect(account2Submissions[0]?.orderRequest.symbol).toBe('MSFT');

      // Cannot get account1's submission from account2
      const crossAccount = await store.getSubmission(account2, submission1.idempotencyKey);
      expect(crossAccount).toBeNull();
    });
  });
});

describe('OrderSubmissionSchema', () => {
  it('validates valid submission', () => {
    const submission = {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      accountId: 'test-account',
      status: 'pending',
      orderRequest: {
        symbol: 'AAPL',
        side: 'buy',
        quantity: 10,
        orderType: 'limit',
        limitPrice: 150.5,
      },
      submittedAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
      retryCount: 0,
    };

    const result = OrderSubmissionSchema.safeParse(submission);
    expect(result.success).toBe(true);
  });

  it('rejects invalid idempotency key', () => {
    const submission = {
      idempotencyKey: 'not-a-uuid',
      accountId: 'test-account',
      status: 'pending',
      orderRequest: {
        symbol: 'AAPL',
        side: 'buy',
        quantity: 10,
        orderType: 'limit',
      },
      submittedAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
      retryCount: 0,
    };

    const result = OrderSubmissionSchema.safeParse(submission);
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const submission = {
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      accountId: 'test-account',
      status: 'invalid-status',
      orderRequest: {
        symbol: 'AAPL',
        side: 'buy',
        quantity: 10,
        orderType: 'limit',
      },
      submittedAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
      retryCount: 0,
    };

    const result = OrderSubmissionSchema.safeParse(submission);
    expect(result.success).toBe(false);
  });

  it('validates all valid statuses', () => {
    const statuses = ['pending', 'submitted', 'filled', 'partially_filled', 'rejected', 'failed', 'canceled'];

    for (const status of statuses) {
      const submission = {
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        accountId: 'test-account',
        status,
        orderRequest: {
          symbol: 'AAPL',
          side: 'buy',
          quantity: 10,
          orderType: 'limit',
        },
        submittedAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z',
        retryCount: 0,
      };

      const result = OrderSubmissionSchema.safeParse(submission);
      expect(result.success).toBe(true);
    }
  });
});
