/**
 * Risk Engine Tests
 *
 * Tests for pre-trade validation against risk configuration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RiskEngine,
  createRiskEngine,
  validateOrder,
  type ValidationContext,
  type RiskEngineLogger,
} from './risk-engine.js';
import type { OrderRequest, Position, AccountSummary, Quote, OptionContract } from '../types/broker.js';
import type { RiskConfig } from '../types/risk-config.js';
import { DEFAULT_RISK_CONFIG } from '../types/risk-config.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createTestAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    netLiquidation: 100000,
    buyingPower: 50000,
    cash: 25000,
    dailyPnL: 0,
    unrealizedPnL: 0,
    currency: 'USD',
    asOf: new Date(),
    ...overrides,
  };
}

function createTestPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    symbol: 'AAPL',
    quantity: 1,
    averageCost: 5.0,
    currentPrice: 5.5,
    marketValue: 550,
    unrealizedPnL: 50,
    unrealizedPnLPercent: 10,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'AAPL240216C00185000',
      underlying: 'AAPL',
      strike: 185,
      expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days out
      optionType: 'call',
      multiplier: 100,
    },
    ...overrides,
  };
}

function createTestOrderRequest(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    symbol: 'AAPL240216C00190000',
    assetClass: 'option',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'day',
    quantity: 1,
    limitPrice: 3.5,
    optionDetails: {
      underlying: 'AAPL',
      strike: 190,
      expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days out
      optionType: 'call',
    },
    ...overrides,
  };
}

function createTestQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: 'AAPL240216C00190000',
    bid: 3.45,
    ask: 3.55, // ~2.9% spread - within default 5% threshold
    mid: 3.5,
    last: 3.5,
    bidSize: 10,
    askSize: 15,
    volume: 1000,
    asOf: new Date(),
    ...overrides,
  };
}

function createTestOptionContract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    optionSymbol: 'AAPL240216C00190000',
    underlying: 'AAPL',
    strike: 190,
    expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    optionType: 'call',
    bid: 3.45,
    ask: 3.55, // ~2.9% spread - within default 5% threshold
    mid: 3.5,
    last: 3.5,
    volume: 1000,
    openInterest: 5000,
    multiplier: 100,
    ...overrides,
  };
}

function createTestConfig(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    ...DEFAULT_RISK_CONFIG,
    ...overrides,
  };
}

// ============================================================================
// RiskEngine Tests
// ============================================================================

describe('RiskEngine', () => {
  let engine: RiskEngine;
  let mockLogger: RiskEngineLogger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    engine = new RiskEngine({ logger: mockLogger });
  });

  describe('validateOrder', () => {
    it('should pass validation for a valid order within all limits', () => {
      const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 });
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
        quote: createTestQuote(),
      };

      const result = engine.validateOrder(order, context);

      expect(result.valid).toBe(true);
      expect(result.rejectionReasons).toHaveLength(0);
      expect(result.checks.every((c) => c.passed)).toBe(true);
    });

    it('should include order in result for audit purposes', () => {
      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);

      expect(result.order).toBe(order);
      expect(result.validatedAt).toBeInstanceOf(Date);
    });

    it('should log successful validation', () => {
      const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 });
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
      };

      engine.validateOrder(order, context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Order validation PASSED',
        expect.objectContaining({ valid: true })
      );
    });

    it('should log failed validation', () => {
      const order = createTestOrderRequest({ quantity: 100, limitPrice: 100 }); // Very expensive
      const context: ValidationContext = {
        config: createTestConfig({ maxRiskPerTradePercent: 1 }),
        account: createTestAccount({ netLiquidation: 10000 }),
        positions: [],
      };

      engine.validateOrder(order, context);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Order validation FAILED',
        expect.objectContaining({ valid: false })
      );
    });
  });

  describe('risk per trade check', () => {
    it('should pass when risk is within limit', () => {
      const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 }); // $100 risk
      const context: ValidationContext = {
        config: createTestConfig({ maxRiskPerTradePercent: 2 }), // 2% of $100k = $2000
        account: createTestAccount({ netLiquidation: 100000 }),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'risk_per_trade');

      expect(check?.passed).toBe(true);
      expect(check?.details?.actual).toBeLessThanOrEqual(2);
    });

    it('should fail when risk exceeds limit', () => {
      const order = createTestOrderRequest({ quantity: 10, limitPrice: 25.0 }); // $25,000 risk
      const context: ValidationContext = {
        config: createTestConfig({ maxRiskPerTradePercent: 2 }), // 2% of $100k = $2000
        account: createTestAccount({ netLiquidation: 100000 }),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'risk_per_trade');

      expect(check?.passed).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.rejectionReasons.some((r) => r.includes('Risk per trade'))).toBe(true);
    });

    it('should fail when account value is zero', () => {
      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount({ netLiquidation: 0 }),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'risk_per_trade');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('account value is zero');
    });
  });

  describe('concentration check', () => {
    it('should pass when concentration is within limit', () => {
      const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 });
      const context: ValidationContext = {
        config: createTestConfig({ maxRiskPerUnderlyingPercent: 10 }),
        account: createTestAccount({ netLiquidation: 100000 }),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'concentration');

      expect(check?.passed).toBe(true);
    });

    it('should fail when concentration exceeds limit', () => {
      // Existing large position + new order
      const existingPosition = createTestPosition({
        symbol: 'AAPL',
        marketValue: 8000, // 8% of account
        optionDetails: {
          optionSymbol: 'AAPL240216C00180000',
          underlying: 'AAPL',
          strike: 180,
          expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          optionType: 'call',
          multiplier: 100,
        },
      });

      const order = createTestOrderRequest({ quantity: 5, limitPrice: 10.0 }); // $5000 more

      const context: ValidationContext = {
        config: createTestConfig({ maxRiskPerUnderlyingPercent: 10 }),
        account: createTestAccount({ netLiquidation: 100000 }),
        positions: [existingPosition],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'concentration');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('exceeds');
    });
  });

  describe('buying power check', () => {
    it('should pass when buying power is sufficient', () => {
      const order = createTestOrderRequest({ quantity: 1, limitPrice: 3.5 }); // $350
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount({ buyingPower: 50000 }),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'buying_power');

      expect(check?.passed).toBe(true);
    });

    it('should fail when buying power is insufficient', () => {
      const order = createTestOrderRequest({ quantity: 100, limitPrice: 10.0 }); // $100,000
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount({ buyingPower: 5000 }),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'buying_power');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('Insufficient buying power');
    });
  });

  describe('DTE range check', () => {
    it('should pass when DTE is within range', () => {
      const expiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      const order = createTestOrderRequest({
        optionDetails: {
          underlying: 'AAPL',
          strike: 190,
          expiration,
          optionType: 'call',
        },
      });

      const context: ValidationContext = {
        config: createTestConfig({ minDTE: 7, maxDTE: 60 }),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'dte_range');

      expect(check?.passed).toBe(true);
    });

    it('should fail when DTE is below minimum', () => {
      const expiration = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
      const order = createTestOrderRequest({
        optionDetails: {
          underlying: 'AAPL',
          strike: 190,
          expiration,
          optionType: 'call',
        },
      });

      const context: ValidationContext = {
        config: createTestConfig({ minDTE: 7, maxDTE: 60 }),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'dte_range');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('below minimum');
    });

    it('should fail when DTE exceeds maximum', () => {
      const expiration = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
      const order = createTestOrderRequest({
        optionDetails: {
          underlying: 'AAPL',
          strike: 190,
          expiration,
          optionType: 'call',
        },
      });

      const context: ValidationContext = {
        config: createTestConfig({ minDTE: 7, maxDTE: 60 }),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'dte_range');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('exceeds maximum');
    });

    it('should skip DTE check for equity orders', () => {
      const order = createTestOrderRequest({
        symbol: 'AAPL',
        assetClass: 'equity',
        optionDetails: undefined,
      });

      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'dte_range');

      // DTE check should not be present for equity orders
      expect(check).toBeUndefined();
    });
  });

  describe('liquidity check', () => {
    it('should pass when spread is within threshold', () => {
      const quote = createTestQuote({ bid: 3.45, ask: 3.55 }); // ~2.9% spread
      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
        quote,
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'liquidity');

      expect(check?.passed).toBe(true);
    });

    it('should fail when spread exceeds threshold', () => {
      const quote = createTestQuote({ bid: 3.0, ask: 4.0 }); // ~28.6% spread
      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
        quote,
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'liquidity');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('Low liquidity');
    });

    it('should fail when bid or ask is zero', () => {
      const quote = createTestQuote({ bid: 0, ask: 3.5 });
      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
        quote,
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'liquidity');

      expect(check?.passed).toBe(false);
    });

    it('should skip liquidity check when no quote provided', () => {
      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
        // No quote
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'liquidity');

      // Should not have liquidity check when no quote
      expect(check).toBeUndefined();
    });

    it('should use custom liquidity threshold', () => {
      const customEngine = new RiskEngine({ liquiditySpreadThreshold: 2 }); // 2% threshold
      const quote = createTestQuote({ bid: 3.40, ask: 3.60 }); // ~5.7% spread - exceeds 2%

      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
        quote,
      };

      const result = customEngine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'liquidity');

      expect(check?.passed).toBe(false);
      expect(check?.details?.limit).toBe(2);
    });
  });

  describe('max positions check', () => {
    it('should pass when within position limit', () => {
      const order = createTestOrderRequest();
      const context: ValidationContext = {
        config: createTestConfig({ maxOpenPositions: 10 }),
        account: createTestAccount(),
        positions: [createTestPosition()], // 1 existing position
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'max_positions');

      expect(check?.passed).toBe(true);
    });

    it('should fail when position limit would be exceeded', () => {
      const positions = Array(10)
        .fill(null)
        .map((_, i) =>
          createTestPosition({
            id: `pos-${i}`,
            symbol: `SYM${i}`,
            optionDetails: {
              optionSymbol: `SYM${i}240216C00100000`,
              underlying: `SYM${i}`,
              strike: 100,
              expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              optionType: 'call',
              multiplier: 100,
            },
          })
        );

      const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 }); // New underlying
      const context: ValidationContext = {
        config: createTestConfig({ maxOpenPositions: 10 }),
        account: createTestAccount(),
        positions,
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'max_positions');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('Max positions exceeded');
    });

    it('should not count as new position when adding to existing underlying', () => {
      const existingPosition = createTestPosition({
        optionDetails: {
          optionSymbol: 'AAPL240216C00180000',
          underlying: 'AAPL',
          strike: 180,
          expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          optionType: 'call',
          multiplier: 100,
        },
      });

      const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 }); // Same underlying (AAPL)
      const context: ValidationContext = {
        config: createTestConfig({ maxOpenPositions: 1 }),
        account: createTestAccount(),
        positions: [existingPosition],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'max_positions');

      expect(check?.passed).toBe(true); // Not a new position, same underlying
    });
  });

  describe('max contracts check', () => {
    it('should pass when within contract limit', () => {
      const order = createTestOrderRequest({ quantity: 5 });
      const context: ValidationContext = {
        config: createTestConfig({ maxContractsPerPosition: 10 }),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'max_contracts');

      expect(check?.passed).toBe(true);
    });

    it('should fail when contract limit would be exceeded', () => {
      const order = createTestOrderRequest({ quantity: 15 });
      const context: ValidationContext = {
        config: createTestConfig({ maxContractsPerPosition: 10 }),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'max_contracts');

      expect(check?.passed).toBe(false);
      expect(check?.message).toContain('Max contracts exceeded');
    });

    it('should include existing position quantity when adding', () => {
      const existingPosition = createTestPosition({
        symbol: 'AAPL240216C00190000',
        quantity: 7,
      });

      const order = createTestOrderRequest({
        symbol: 'AAPL240216C00190000',
        side: 'buy',
        quantity: 5,
      }); // Adding 5 to existing 7

      const context: ValidationContext = {
        config: createTestConfig({ maxContractsPerPosition: 10 }),
        account: createTestAccount(),
        positions: [existingPosition],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'max_contracts');

      expect(check?.passed).toBe(false);
      expect(check?.details?.actual).toBe(12); // 7 + 5
    });

    it('should skip contract check for equity orders', () => {
      const order = createTestOrderRequest({
        symbol: 'AAPL',
        assetClass: 'equity',
        optionDetails: undefined,
      });

      const context: ValidationContext = {
        config: createTestConfig(),
        account: createTestAccount(),
        positions: [],
      };

      const result = engine.validateOrder(order, context);
      const check = result.checks.find((c) => c.checkType === 'max_contracts');

      expect(check?.passed).toBe(true);
      expect(check?.message).toContain('applies only to options');
    });
  });

  describe('multiple check failures', () => {
    it('should report all failed checks', () => {
      const order = createTestOrderRequest({
        quantity: 50,
        limitPrice: 100, // High risk + high contracts
        optionDetails: {
          underlying: 'AAPL',
          strike: 190,
          expiration: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days - too short
          optionType: 'call',
        },
      });

      const context: ValidationContext = {
        config: createTestConfig({
          maxRiskPerTradePercent: 1,
          maxContractsPerPosition: 10,
          minDTE: 7,
        }),
        account: createTestAccount({ netLiquidation: 10000, buyingPower: 1000 }),
        positions: [],
        quote: createTestQuote({ bid: 50, ask: 150 }), // Wide spread
      };

      const result = engine.validateOrder(order, context);

      expect(result.valid).toBe(false);
      expect(result.rejectionReasons.length).toBeGreaterThan(1);

      // Should have multiple failed checks
      const failedChecks = result.checks.filter((c) => !c.passed);
      expect(failedChecks.length).toBeGreaterThan(1);
    });
  });
});

// ============================================================================
// Factory Function Tests
// ============================================================================

describe('createRiskEngine', () => {
  it('should create a RiskEngine instance', () => {
    const engine = createRiskEngine();
    expect(engine).toBeInstanceOf(RiskEngine);
  });

  it('should create a RiskEngine with custom config', () => {
    const mockLogger: RiskEngineLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const engine = createRiskEngine({
      logger: mockLogger,
      liquiditySpreadThreshold: 3,
    });

    // Verify logger is used
    const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 });
    const context: ValidationContext = {
      config: createTestConfig(),
      account: createTestAccount(),
      positions: [],
    };

    engine.validateOrder(order, context);

    expect(mockLogger.info).toHaveBeenCalled();
  });
});

// ============================================================================
// Standalone Function Tests
// ============================================================================

describe('validateOrder standalone function', () => {
  it('should validate an order', () => {
    const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 });
    const config = createTestConfig();
    const account = createTestAccount();
    const positions: Position[] = [];

    const result = validateOrder(order, config, account, positions);

    expect(result.valid).toBe(true);
  });

  it('should accept optional quote parameter', () => {
    const order = createTestOrderRequest();
    const config = createTestConfig();
    const account = createTestAccount();
    const positions: Position[] = [];
    const quote = createTestQuote(); // Uses default tight spread

    const result = validateOrder(order, config, account, positions, quote);

    const liquidityCheck = result.checks.find((c) => c.checkType === 'liquidity');
    expect(liquidityCheck).toBeDefined();
    expect(liquidityCheck?.passed).toBe(true);
  });

  it('should work with OptionContract as quote', () => {
    const order = createTestOrderRequest();
    const config = createTestConfig();
    const account = createTestAccount();
    const positions: Position[] = [];
    const optionContract = createTestOptionContract();

    const result = validateOrder(order, config, account, positions, optionContract);

    const liquidityCheck = result.checks.find((c) => c.checkType === 'liquidity');
    expect(liquidityCheck).toBeDefined();
    expect(liquidityCheck?.passed).toBe(true);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  let engine: RiskEngine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  it('should handle sell orders', () => {
    const order = createTestOrderRequest({ side: 'sell', quantity: 1, limitPrice: 5.0 });
    const context: ValidationContext = {
      config: createTestConfig(),
      account: createTestAccount(),
      positions: [createTestPosition({ quantity: 5 })], // Have position to sell
    };

    const result = engine.validateOrder(order, context);

    // Should complete validation without errors
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('should handle missing limit price', () => {
    const order = createTestOrderRequest({
      orderType: 'market',
      limitPrice: undefined,
    });

    const context: ValidationContext = {
      config: createTestConfig(),
      account: createTestAccount(),
      positions: [],
      quote: createTestQuote(),
    };

    const result = engine.validateOrder(order, context);

    // Should use quote mid price for calculations
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('should handle empty positions array', () => {
    const order = createTestOrderRequest({ quantity: 1, limitPrice: 1.0 });
    const context: ValidationContext = {
      config: createTestConfig(),
      account: createTestAccount(),
      positions: [],
    };

    const result = engine.validateOrder(order, context);

    expect(result.valid).toBe(true);
  });

  it('should handle negative account values gracefully', () => {
    const order = createTestOrderRequest();
    const context: ValidationContext = {
      config: createTestConfig(),
      account: createTestAccount({ netLiquidation: -1000 }),
      positions: [],
    };

    const result = engine.validateOrder(order, context);
    const riskCheck = result.checks.find((c) => c.checkType === 'risk_per_trade');

    expect(riskCheck?.passed).toBe(false);
    expect(riskCheck?.message).toContain('zero or negative');
  });
});
