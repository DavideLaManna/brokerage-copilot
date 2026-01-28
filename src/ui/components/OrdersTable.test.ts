/**
 * OrdersTable Component Tests
 */

import { describe, it, expect } from 'vitest';
import {
  getContractDescription,
  getOrderTypeLabel,
  formatCurrency,
  formatDate,
  formatTime,
} from './OrdersTable.js';
import type { Order } from '../types.js';

describe('OrdersTable helper functions', () => {
  describe('formatCurrency', () => {
    it('should format positive numbers as currency', () => {
      expect(formatCurrency(123.45)).toBe('$123.45');
    });

    it('should format zero as currency', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('should format large numbers with commas', () => {
      expect(formatCurrency(1234567.89)).toBe('$1,234,567.89');
    });

    it('should format negative numbers as currency', () => {
      expect(formatCurrency(-50.00)).toBe('-$50.00');
    });

    it('should round to two decimal places', () => {
      expect(formatCurrency(123.456)).toBe('$123.46');
    });
  });

  describe('formatDate', () => {
    it('should format date correctly', () => {
      const date = new Date('2024-02-16T12:00:00Z');
      const result = formatDate(date);
      // Format is like "Feb 16, 24" or "Feb 16, '24" depending on locale
      expect(result).toMatch(/Feb\s+16,\s+['']?24/);
    });

    it('should handle different months', () => {
      const date = new Date('2024-12-25T12:00:00Z');
      const result = formatDate(date);
      expect(result).toMatch(/Dec\s+25,\s+['']?24/);
    });
  });

  describe('formatTime', () => {
    it('should format time correctly', () => {
      const date = new Date('2024-02-16T14:30:00Z');
      const result = formatTime(date);
      // Format is like "HH:MM AM/PM" based on locale
      expect(result).toMatch(/\d{1,2}:\d{2}\s*[AP]M/i);
    });
  });

  describe('getOrderTypeLabel', () => {
    it('should return MKT for market orders', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'AAPL',
        assetClass: 'equity',
        side: 'buy',
        orderType: 'market',
        timeInForce: 'day',
        quantity: 10,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
      };
      expect(getOrderTypeLabel(order)).toBe('MKT');
    });

    it('should return LMT for limit orders', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'AAPL',
        assetClass: 'equity',
        side: 'buy',
        orderType: 'limit',
        timeInForce: 'day',
        quantity: 10,
        limitPrice: 150.00,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
      };
      expect(getOrderTypeLabel(order)).toBe('LMT');
    });

    it('should return STP for stop orders', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'AAPL',
        assetClass: 'equity',
        side: 'sell',
        orderType: 'stop',
        timeInForce: 'day',
        quantity: 10,
        stopPrice: 145.00,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
      };
      expect(getOrderTypeLabel(order)).toBe('STP');
    });

    it('should return STP LMT for stop limit orders', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'AAPL',
        assetClass: 'equity',
        side: 'sell',
        orderType: 'stop_limit',
        timeInForce: 'day',
        quantity: 10,
        limitPrice: 145.00,
        stopPrice: 144.00,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
      };
      expect(getOrderTypeLabel(order)).toBe('STP LMT');
    });
  });

  describe('getContractDescription', () => {
    it('should return symbol for equity orders', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'AAPL',
        assetClass: 'equity',
        side: 'buy',
        orderType: 'limit',
        timeInForce: 'day',
        quantity: 10,
        limitPrice: 150.00,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
      };
      expect(getContractDescription(order)).toBe('AAPL');
    });

    it('should return formatted description for option orders', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'AAPL240216C00185000',
        assetClass: 'option',
        side: 'buy',
        orderType: 'limit',
        timeInForce: 'day',
        quantity: 5,
        limitPrice: 5.00,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
        optionDetails: {
          optionSymbol: 'AAPL240216C00185000',
          underlying: 'AAPL',
          strike: 185,
          expiration: new Date('2024-02-16'),
          optionType: 'call',
          multiplier: 100,
        },
      };

      const result = getContractDescription(order);
      // Should include underlying, date, strike, and type
      expect(result).toContain('AAPL');
      expect(result).toContain('$185');
      expect(result).toContain('C'); // Call
    });

    it('should return formatted description for put options', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'SPY240315P00475000',
        assetClass: 'option',
        side: 'sell',
        orderType: 'limit',
        timeInForce: 'gtc',
        quantity: 3,
        limitPrice: 2.50,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
        optionDetails: {
          optionSymbol: 'SPY240315P00475000',
          underlying: 'SPY',
          strike: 475,
          expiration: new Date('2024-03-15'),
          optionType: 'put',
          multiplier: 100,
        },
      };

      const result = getContractDescription(order);
      expect(result).toContain('SPY');
      expect(result).toContain('$475');
      expect(result).toContain('P'); // Put
    });

    it('should return symbol when option order has no optionDetails', () => {
      const order: Order = {
        id: 'ord-1',
        symbol: 'AAPL240216C00185000',
        assetClass: 'option',
        side: 'buy',
        orderType: 'limit',
        timeInForce: 'day',
        quantity: 5,
        limitPrice: 5.00,
        filledQuantity: 0,
        status: 'open',
        submittedAt: new Date(),
        // No optionDetails
      };

      expect(getContractDescription(order)).toBe('AAPL240216C00185000');
    });
  });
});

describe('OrdersTable order status helpers', () => {
  it('should recognize cancelable statuses', () => {
    const cancelableStatuses = ['open', 'pending', 'partially_filled'];
    const nonCancelableStatuses = ['filled', 'canceled', 'rejected', 'expired'];

    // These are inline in the component, but we can test the logic
    const canCancel = (status: string): boolean => {
      return cancelableStatuses.includes(status);
    };

    // Cancelable
    expect(canCancel('open')).toBe(true);
    expect(canCancel('pending')).toBe(true);
    expect(canCancel('partially_filled')).toBe(true);

    // Not cancelable
    expect(canCancel('filled')).toBe(false);
    expect(canCancel('canceled')).toBe(false);
    expect(canCancel('rejected')).toBe(false);
    expect(canCancel('expired')).toBe(false);
  });
});

describe('OrdersTable types', () => {
  it('should accept valid Order type', () => {
    const order: Order = {
      id: 'ord-1',
      symbol: 'AAPL',
      assetClass: 'equity',
      side: 'buy',
      orderType: 'limit',
      timeInForce: 'day',
      quantity: 10,
      limitPrice: 150.00,
      filledQuantity: 0,
      status: 'open',
      submittedAt: new Date(),
    };

    expect(order.id).toBe('ord-1');
    expect(order.symbol).toBe('AAPL');
    expect(order.side).toBe('buy');
    expect(order.status).toBe('open');
  });

  it('should handle partially filled orders', () => {
    const order: Order = {
      id: 'ord-1',
      symbol: 'AAPL',
      assetClass: 'equity',
      side: 'buy',
      orderType: 'limit',
      timeInForce: 'day',
      quantity: 100,
      limitPrice: 150.00,
      filledQuantity: 25,
      averageFillPrice: 149.50,
      status: 'partially_filled',
      submittedAt: new Date(),
    };

    expect(order.filledQuantity).toBe(25);
    expect(order.averageFillPrice).toBe(149.50);
    expect(order.status).toBe('partially_filled');
  });

  it('should handle filled orders with filledAt date', () => {
    const submittedAt = new Date('2024-01-15T10:00:00Z');
    const filledAt = new Date('2024-01-15T10:05:00Z');

    const order: Order = {
      id: 'ord-1',
      symbol: 'AAPL',
      assetClass: 'equity',
      side: 'buy',
      orderType: 'market',
      timeInForce: 'day',
      quantity: 100,
      filledQuantity: 100,
      averageFillPrice: 150.25,
      status: 'filled',
      submittedAt,
      filledAt,
    };

    expect(order.filledAt).toEqual(filledAt);
    expect(order.submittedAt).toEqual(submittedAt);
  });
});
