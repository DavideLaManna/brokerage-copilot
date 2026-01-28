/**
 * Tests for ExecutionResultModal
 */

import { describe, it, expect } from 'vitest';
import {
  getStatusText,
  getStatusClass,
  getStatusIcon,
} from './ExecutionResultModal';
import type { OrderExecutionResponse, OrderSubmissionResult } from '../services/api';

describe('ExecutionResultModal', () => {
  describe('getStatusText', () => {
    it('should return correct text for executed status', () => {
      expect(getStatusText('executed')).toBe('Order Executed Successfully');
    });

    it('should return correct text for partially_executed status', () => {
      expect(getStatusText('partially_executed')).toBe('Partially Executed');
    });

    it('should return correct text for failed status', () => {
      expect(getStatusText('failed')).toBe('Execution Failed');
    });

    it('should return correct text for validation_failed status', () => {
      expect(getStatusText('validation_failed')).toBe('Validation Failed');
    });

    it('should return Unknown Status for invalid status', () => {
      expect(getStatusText('invalid' as any)).toBe('Unknown Status');
    });
  });

  describe('getStatusClass', () => {
    it('should return success class for executed status', () => {
      expect(getStatusClass('executed')).toBe('execution-status--success');
    });

    it('should return warning class for partially_executed status', () => {
      expect(getStatusClass('partially_executed')).toBe('execution-status--warning');
    });

    it('should return error class for failed status', () => {
      expect(getStatusClass('failed')).toBe('execution-status--error');
    });

    it('should return error class for validation_failed status', () => {
      expect(getStatusClass('validation_failed')).toBe('execution-status--error');
    });

    it('should return empty string for invalid status', () => {
      expect(getStatusClass('invalid' as any)).toBe('');
    });
  });

  describe('getStatusIcon', () => {
    it('should return checkmark for executed status', () => {
      expect(getStatusIcon('executed')).toBe('✓');
    });

    it('should return exclamation for partially_executed status', () => {
      expect(getStatusIcon('partially_executed')).toBe('!');
    });

    it('should return X for failed status', () => {
      expect(getStatusIcon('failed')).toBe('✗');
    });

    it('should return X for validation_failed status', () => {
      expect(getStatusIcon('validation_failed')).toBe('✗');
    });

    it('should return question mark for invalid status', () => {
      expect(getStatusIcon('invalid' as any)).toBe('?');
    });
  });

  describe('Type validation', () => {
    it('should accept valid OrderExecutionResponse', () => {
      const result: OrderExecutionResponse = {
        success: true,
        status: 'executed',
        proposalId: 'prop-123',
        correlationId: 'corr-456',
        orderResults: [
          {
            success: true,
            idempotencyKey: 'key-1',
            orderId: 'order-789',
            retryCount: 0,
          },
        ],
        summary: { total: 1, succeeded: 1, failed: 0 },
        brokerOrderIds: ['order-789'],
        executedAt: '2026-01-28T12:00:00Z',
      };

      expect(result.success).toBe(true);
      expect(result.status).toBe('executed');
      expect(result.brokerOrderIds).toHaveLength(1);
    });

    it('should accept failed OrderExecutionResponse', () => {
      const result: OrderExecutionResponse = {
        success: false,
        status: 'failed',
        correlationId: 'corr-456',
        orderResults: [
          {
            success: false,
            idempotencyKey: 'key-1',
            errorMessage: 'Insufficient funds',
            errorCode: 'INSUFFICIENT_FUNDS',
            retryCount: 2,
          },
        ],
        summary: { total: 1, succeeded: 0, failed: 1 },
        brokerOrderIds: [],
        errorMessage: 'Insufficient funds',
        executedAt: '2026-01-28T12:00:00Z',
      };

      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('Insufficient funds');
    });

    it('should accept partial execution result', () => {
      const result: OrderExecutionResponse = {
        success: false,
        status: 'partially_executed',
        correlationId: 'corr-456',
        orderResults: [
          {
            success: true,
            idempotencyKey: 'key-1',
            orderId: 'order-1',
            retryCount: 0,
          },
          {
            success: false,
            idempotencyKey: 'key-2',
            errorMessage: 'Market closed',
            errorCode: 'MARKET_CLOSED',
            retryCount: 0,
          },
        ],
        summary: { total: 2, succeeded: 1, failed: 1 },
        brokerOrderIds: ['order-1'],
        errorMessage: 'Some orders failed',
        executedAt: '2026-01-28T12:00:00Z',
      };

      expect(result.success).toBe(false);
      expect(result.status).toBe('partially_executed');
      expect(result.summary.succeeded).toBe(1);
      expect(result.summary.failed).toBe(1);
    });

    it('should accept validation failure result', () => {
      const result: OrderExecutionResponse = {
        success: false,
        status: 'validation_failed',
        proposalId: 'prop-123',
        correlationId: 'corr-456',
        orderResults: [],
        summary: { total: 1, succeeded: 0, failed: 1 },
        brokerOrderIds: [],
        errorMessage: 'Pre-trade validation failed: Risk per trade exceeded',
        executedAt: '2026-01-28T12:00:00Z',
      };

      expect(result.success).toBe(false);
      expect(result.status).toBe('validation_failed');
      expect(result.orderResults).toHaveLength(0);
    });
  });

  describe('OrderSubmissionResult type', () => {
    it('should accept successful submission result', () => {
      const result: OrderSubmissionResult = {
        success: true,
        idempotencyKey: 'uuid-123',
        orderId: 'broker-order-456',
        retryCount: 0,
      };

      expect(result.success).toBe(true);
      expect(result.orderId).toBe('broker-order-456');
    });

    it('should accept failed submission result', () => {
      const result: OrderSubmissionResult = {
        success: false,
        idempotencyKey: 'uuid-123',
        errorMessage: 'Invalid order',
        errorCode: 'INVALID_ORDER',
        retryCount: 3,
      };

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Invalid order');
      expect(result.retryCount).toBe(3);
    });

    it('should accept duplicate submission result', () => {
      const result: OrderSubmissionResult = {
        success: true,
        idempotencyKey: 'uuid-123',
        orderId: 'broker-order-456',
        isDuplicate: true,
        retryCount: 0,
      };

      expect(result.success).toBe(true);
      expect(result.isDuplicate).toBe(true);
    });
  });
});
