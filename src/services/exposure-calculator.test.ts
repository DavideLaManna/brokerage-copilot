/**
 * Tests for Portfolio Exposure Calculator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ExposureCalculator,
  createExposureCalculator,
  calculatePortfolioExposure,
  getExceedingLimitUnderlyings,
  formatExposureForDisplay,
  type PortfolioExposure,
} from './exposure-calculator.js';
import type { Position, AccountSummary } from '../types/broker.js';
import type { RiskConfig } from '../types/risk-config.js';

// Helper to create mock positions
function createMockPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    symbol: 'AAPL',
    quantity: 100,
    averageCost: 150,
    currentPrice: 160,
    marketValue: 16000,
    unrealizedPnL: 1000,
    unrealizedPnLPercent: 6.67,
    assetClass: 'equity',
    ...overrides,
  };
}

function createMockOptionPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-opt-1',
    symbol: 'AAPL240216C00185000',
    quantity: 5,
    averageCost: 4.25,
    currentPrice: 5.80,
    marketValue: 2900,
    unrealizedPnL: 775,
    unrealizedPnLPercent: 36.47,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'AAPL240216C00185000',
      underlying: 'AAPL',
      strike: 185,
      expiration: new Date('2024-12-16'),
      optionType: 'call',
      multiplier: 100,
      greeks: {
        delta: 0.65,
        gamma: 0.08,
        theta: -0.15,
        vega: 0.25,
        impliedVolatility: 0.28,
      },
    },
    ...overrides,
  };
}

function createMockAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    netLiquidation: 100000,
    buyingPower: 50000,
    cash: 25000,
    dailyPnL: 500,
    unrealizedPnL: 1500,
    currency: 'USD',
    asOf: new Date(),
    ...overrides,
  };
}

describe('ExposureCalculator', () => {
  let calculator: ExposureCalculator;
  let mockAccount: AccountSummary;

  beforeEach(() => {
    calculator = new ExposureCalculator();
    mockAccount = createMockAccount();
  });

  describe('calculateExposure', () => {
    it('should return empty underlyings for empty positions', () => {
      const result = calculator.calculateExposure([], mockAccount);

      expect(result.underlyings).toHaveLength(0);
      expect(result.totalNotionalExposure).toBe(0);
      expect(result.totalRisk).toBe(0);
      expect(result.underlyingCount).toBe(0);
    });

    it('should aggregate equity positions by symbol', () => {
      const positions = [
        createMockPosition({ id: 'pos-1', symbol: 'AAPL', marketValue: 10000 }),
        createMockPosition({ id: 'pos-2', symbol: 'AAPL', marketValue: 5000 }),
        createMockPosition({ id: 'pos-3', symbol: 'MSFT', marketValue: 8000 }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);

      expect(result.underlyingCount).toBe(2);

      const aapl = result.underlyings.find((u) => u.symbol === 'AAPL');
      expect(aapl).toBeDefined();
      expect(aapl!.positionCount).toBe(2);
      expect(aapl!.marketValue).toBe(15000);

      const msft = result.underlyings.find((u) => u.symbol === 'MSFT');
      expect(msft).toBeDefined();
      expect(msft!.positionCount).toBe(1);
    });

    it('should group option positions by underlying symbol', () => {
      const positions = [
        createMockOptionPosition({
          id: 'pos-1',
          optionDetails: {
            optionSymbol: 'AAPL240216C00185000',
            underlying: 'AAPL',
            strike: 185,
            expiration: new Date('2024-12-16'),
            optionType: 'call',
            multiplier: 100,
          },
        }),
        createMockOptionPosition({
          id: 'pos-2',
          optionDetails: {
            optionSymbol: 'AAPL240216P00180000',
            underlying: 'AAPL',
            strike: 180,
            expiration: new Date('2024-12-16'),
            optionType: 'put',
            multiplier: 100,
          },
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);

      expect(result.underlyingCount).toBe(1);
      expect(result.underlyings[0].symbol).toBe('AAPL');
      expect(result.underlyings[0].positionCount).toBe(2);
    });

    it('should calculate notional exposure for equity positions', () => {
      const positions = [
        createMockPosition({
          symbol: 'AAPL',
          quantity: 100,
          currentPrice: 150,
          marketValue: 15000,
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // Notional for equity = |quantity * price|
      expect(underlying.notionalExposure).toBe(15000);
    });

    it('should calculate notional exposure for option positions', () => {
      const positions = [
        createMockOptionPosition({
          quantity: 10,
          optionDetails: {
            optionSymbol: 'AAPL240216C00185000',
            underlying: 'AAPL',
            strike: 200,
            expiration: new Date('2024-12-16'),
            optionType: 'call',
            multiplier: 100,
          },
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // Notional for options = contracts * strike * multiplier
      expect(underlying.notionalExposure).toBe(10 * 200 * 100);
    });

    it('should calculate risk for long equity positions', () => {
      const positions = [
        createMockPosition({
          symbol: 'AAPL',
          quantity: 100,
          marketValue: 15000,
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // Long equity risk = market value (can go to zero)
      expect(underlying.risk).toBe(15000);
    });

    it('should calculate risk for short equity positions', () => {
      const positions = [
        createMockPosition({
          symbol: 'AAPL',
          quantity: -100,
          marketValue: -15000,
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // Short equity risk = 2x market value (unlimited proxy)
      expect(underlying.risk).toBe(30000);
    });

    it('should calculate risk for long options', () => {
      const positions = [
        createMockOptionPosition({
          quantity: 5,
          marketValue: 2500,
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // Long option risk = premium paid (market value)
      expect(underlying.risk).toBe(2500);
    });

    it('should calculate risk for short puts', () => {
      const positions = [
        createMockOptionPosition({
          quantity: -5,
          marketValue: -2500,
          optionDetails: {
            optionSymbol: 'AAPL240216P00185000',
            underlying: 'AAPL',
            strike: 185,
            expiration: new Date('2024-12-16'),
            optionType: 'put',
            multiplier: 100,
          },
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // Short put risk = strike * multiplier * contracts
      expect(underlying.risk).toBe(185 * 100 * 5);
    });

    it('should calculate risk for short calls', () => {
      const positions = [
        createMockOptionPosition({
          quantity: -5,
          marketValue: -2500,
          optionDetails: {
            optionSymbol: 'AAPL240216C00185000',
            underlying: 'AAPL',
            strike: 185,
            expiration: new Date('2024-12-16'),
            optionType: 'call',
            multiplier: 100,
          },
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // Short call risk = 3x strike * multiplier * contracts (unlimited proxy)
      expect(underlying.risk).toBe(185 * 100 * 5 * 3);
    });

    it('should calculate exposure percentages correctly', () => {
      const positions = [
        createMockPosition({
          symbol: 'AAPL',
          quantity: 100,
          currentPrice: 100,
          marketValue: 10000,
        }),
      ];
      const account = createMockAccount({ netLiquidation: 100000 });

      const result = calculator.calculateExposure(positions, account);
      const underlying = result.underlyings[0];

      expect(underlying.exposurePercent).toBe(10);
      expect(underlying.riskPercent).toBe(10);
    });

    it('should flag underlyings exceeding concentration limit', () => {
      const positions = [
        createMockPosition({
          symbol: 'AAPL',
          quantity: 100,
          currentPrice: 150,
          marketValue: 15000, // 15% of $100k account
        }),
      ];
      const account = createMockAccount({ netLiquidation: 100000 });

      const result = calculator.calculateExposure(positions, account);
      const underlying = result.underlyings[0];

      // Default limit is 10%, 15% exceeds
      expect(underlying.exceedsLimit).toBe(true);
      expect(underlying.warning).toContain('exceeds');
      expect(result.exceedingLimitCount).toBe(1);
    });

    it('should not flag underlyings within concentration limit', () => {
      const positions = [
        createMockPosition({
          symbol: 'AAPL',
          quantity: 50,
          currentPrice: 100,
          marketValue: 5000, // 5% of $100k account
        }),
      ];
      const account = createMockAccount({ netLiquidation: 100000 });

      const result = calculator.calculateExposure(positions, account);
      const underlying = result.underlyings[0];

      expect(underlying.exceedsLimit).toBe(false);
      expect(underlying.warning).toBeUndefined();
      expect(result.exceedingLimitCount).toBe(0);
    });

    it('should use risk config concentration limit when provided', () => {
      const positions = [
        createMockPosition({
          symbol: 'AAPL',
          marketValue: 15000, // 15% of $100k account
        }),
      ];
      const account = createMockAccount({ netLiquidation: 100000 });
      const riskConfig: RiskConfig = {
        maxRiskPerTradePercent: 2,
        maxRiskPerUnderlyingPercent: 20, // Higher limit
        maxDailyLoss: 5000,
        maxOpenPositions: 10,
        maxContractsPerPosition: 10,
        minDTE: 7,
        maxDTE: 60,
      };

      const result = calculator.calculateExposure(positions, account, riskConfig);
      const underlying = result.underlyings[0];

      // 15% is within 20% limit
      expect(underlying.exceedsLimit).toBe(false);
    });

    it('should sort underlyings by exposure percentage descending', () => {
      const positions = [
        createMockPosition({ id: 'pos-1', symbol: 'MSFT', quantity: 50, currentPrice: 100, marketValue: 5000 }),
        createMockPosition({ id: 'pos-2', symbol: 'AAPL', quantity: 100, currentPrice: 200, marketValue: 20000 }),
        createMockPosition({ id: 'pos-3', symbol: 'GOOGL', quantity: 100, currentPrice: 100, marketValue: 10000 }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);

      expect(result.underlyings[0].symbol).toBe('AAPL');
      expect(result.underlyings[1].symbol).toBe('GOOGL');
      expect(result.underlyings[2].symbol).toBe('MSFT');
    });

    it('should aggregate Greeks for option positions', () => {
      const positions = [
        createMockOptionPosition({
          id: 'pos-1',
          quantity: 10,
          optionDetails: {
            optionSymbol: 'AAPL240216C00185000',
            underlying: 'AAPL',
            strike: 185,
            expiration: new Date('2024-12-16'),
            optionType: 'call',
            multiplier: 100,
            greeks: {
              delta: 0.5,
              gamma: 0.02,
              theta: -0.10,
              vega: 0.20,
            },
          },
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      expect(underlying.aggregatedGreeks).toBeDefined();
      // delta = 0.5 * 10 * 100 = 500
      expect(underlying.aggregatedGreeks!.delta).toBe(500);
      // gamma = 0.02 * 10 * 100 = 20
      expect(underlying.aggregatedGreeks!.gamma).toBe(20);
      // theta = -0.10 * 10 * 100 = -100
      expect(underlying.aggregatedGreeks!.theta).toBe(-100);
      // vega = 0.20 * 10 * 100 = 200
      expect(underlying.aggregatedGreeks!.vega).toBe(200);
    });

    it('should calculate net quantity (delta-equivalent) for options', () => {
      const positions = [
        createMockOptionPosition({
          quantity: 10,
          optionDetails: {
            optionSymbol: 'AAPL240216C00185000',
            underlying: 'AAPL',
            strike: 185,
            expiration: new Date('2024-12-16'),
            optionType: 'call',
            multiplier: 100,
            greeks: {
              delta: 0.5,
            },
          },
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const underlying = result.underlyings[0];

      // net qty = quantity * delta * multiplier = 10 * 0.5 * 100 = 500
      expect(underlying.netQuantity).toBe(500);
    });

    it('should include position summaries with DTE for options', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30); // 30 days from now

      const positions = [
        createMockOptionPosition({
          optionDetails: {
            optionSymbol: 'AAPL240216C00185000',
            underlying: 'AAPL',
            strike: 185,
            expiration: futureDate,
            optionType: 'call',
            multiplier: 100,
          },
        }),
      ];

      const result = calculator.calculateExposure(positions, mockAccount);
      const positionSummary = result.underlyings[0].positions[0];

      expect(positionSummary.dte).toBeDefined();
      expect(positionSummary.dte).toBeGreaterThanOrEqual(29);
      expect(positionSummary.dte).toBeLessThanOrEqual(30);
    });

    it('should handle zero account value gracefully', () => {
      const positions = [createMockPosition()];
      const account = createMockAccount({ netLiquidation: 0 });

      const result = calculator.calculateExposure(positions, account);

      // Should still calculate but percentages will be 0
      expect(result.underlyings[0].exposurePercent).toBe(0);
      expect(result.underlyings[0].riskPercent).toBe(0);
    });

    it('should calculate total portfolio metrics', () => {
      const positions = [
        createMockPosition({ id: 'pos-1', symbol: 'AAPL', quantity: 100, currentPrice: 100, marketValue: 10000 }),
        createMockPosition({ id: 'pos-2', symbol: 'MSFT', quantity: 50, currentPrice: 100, marketValue: 5000 }),
      ];
      const account = createMockAccount({ netLiquidation: 100000 });

      const result = calculator.calculateExposure(positions, account);

      expect(result.totalNotionalExposure).toBe(15000);
      expect(result.totalRisk).toBe(15000);
      expect(result.totalRiskPercent).toBe(15);
      expect(result.underlyingCount).toBe(2);
    });
  });

  describe('createExposureCalculator', () => {
    it('should create calculator with default config', () => {
      const calc = createExposureCalculator();
      expect(calc).toBeInstanceOf(ExposureCalculator);
    });

    it('should create calculator with custom concentration limit', () => {
      const calc = createExposureCalculator({ concentrationLimitPercent: 20 });
      const positions = [
        createMockPosition({ marketValue: 15000 }), // 15% of 100k
      ];
      const account = createMockAccount({ netLiquidation: 100000 });

      const result = calc.calculateExposure(positions, account);

      // With 20% limit, 15% should not exceed
      expect(result.underlyings[0].exceedsLimit).toBe(false);
    });
  });

  describe('calculatePortfolioExposure', () => {
    it('should work as standalone function', () => {
      const positions = [createMockPosition()];
      const account = createMockAccount();

      const result = calculatePortfolioExposure(positions, account);

      expect(result.underlyings).toHaveLength(1);
    });
  });

  describe('getExceedingLimitUnderlyings', () => {
    it('should return only underlyings exceeding limit', () => {
      const positions = [
        createMockPosition({ id: 'pos-1', symbol: 'AAPL', marketValue: 15000 }), // 15%
        createMockPosition({ id: 'pos-2', symbol: 'MSFT', marketValue: 5000 }),  // 5%
      ];
      const account = createMockAccount({ netLiquidation: 100000 });

      const exposure = calculatePortfolioExposure(positions, account);
      const exceeding = getExceedingLimitUnderlyings(exposure);

      expect(exceeding).toHaveLength(1);
      expect(exceeding[0].symbol).toBe('AAPL');
    });

    it('should return empty array when none exceed', () => {
      const positions = [
        createMockPosition({ marketValue: 5000 }), // 5%
      ];
      const account = createMockAccount({ netLiquidation: 100000 });

      const exposure = calculatePortfolioExposure(positions, account);
      const exceeding = getExceedingLimitUnderlyings(exposure);

      expect(exceeding).toHaveLength(0);
    });
  });

  describe('formatExposureForDisplay', () => {
    it('should format exposure data for display', () => {
      const positions = [createMockPosition({ symbol: 'AAPL', marketValue: 10000 })];
      const account = createMockAccount({ netLiquidation: 100000 });

      const exposure = calculatePortfolioExposure(positions, account);
      const formatted = formatExposureForDisplay(exposure.underlyings[0]);

      expect(formatted['Symbol']).toBe('AAPL');
      expect(formatted['Positions']).toBe('1');
      expect(formatted['Risk %']).toContain('%');
      expect(formatted['Market Value']).toContain('$');
    });
  });
});
