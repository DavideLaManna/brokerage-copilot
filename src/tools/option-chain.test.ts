/**
 * Tests for Option Chain Tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrokerAdapter, OptionChain, OptionContract, Greeks } from '../types/broker.js';
import {
  buildOptionChainSnapshot,
  createOptionChainTool,
  getOptionChain,
  GetOptionChainInputSchema,
  type OptionChainToolContext,
  type GetOptionChainInput,
} from './option-chain.js';
import { ToolRegistry } from './registry.js';

// ============================================================================
// Mock Data
// ============================================================================

const mockGreeks: Greeks = {
  delta: 0.45,
  gamma: 0.05,
  theta: -0.02,
  vega: 0.15,
  impliedVolatility: 0.35,
};

function createMockContract(
  underlying: string,
  strike: number,
  optionType: 'call' | 'put',
  expiration: Date,
  overrides: Partial<OptionContract> = {}
): OptionContract {
  const expirationStr = expiration.toISOString().split('T')[0].replace(/-/g, '').slice(2);
  const strikeStr = (strike * 1000).toString().padStart(8, '0');
  const typeChar = optionType === 'call' ? 'C' : 'P';
  const optionSymbol = `${underlying}${expirationStr}${typeChar}${strikeStr}`;

  return {
    optionSymbol,
    underlying,
    strike,
    expiration,
    optionType,
    bid: optionType === 'call' ? 2.5 : 1.5,
    ask: optionType === 'call' ? 2.7 : 1.7,
    mid: optionType === 'call' ? 2.6 : 1.6,
    last: optionType === 'call' ? 2.55 : 1.55,
    volume: 500,
    openInterest: 2000,
    multiplier: 100,
    greeks: mockGreeks,
    ...overrides,
  };
}

function createMockOptionChain(underlying: string): OptionChain {
  const today = new Date();
  const exp1 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const exp2 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const exp1Str = exp1.toISOString();
  const exp2Str = exp2.toISOString();

  const contracts = new Map<string, OptionContract[]>();

  // First expiration contracts
  contracts.set(exp1Str, [
    createMockContract(underlying, 150, 'call', exp1),
    createMockContract(underlying, 155, 'call', exp1),
    createMockContract(underlying, 160, 'call', exp1),
    createMockContract(underlying, 150, 'put', exp1),
    createMockContract(underlying, 155, 'put', exp1),
    createMockContract(underlying, 160, 'put', exp1),
  ]);

  // Second expiration contracts
  contracts.set(exp2Str, [
    createMockContract(underlying, 145, 'call', exp2),
    createMockContract(underlying, 150, 'call', exp2),
    createMockContract(underlying, 155, 'call', exp2),
    createMockContract(underlying, 160, 'call', exp2),
    createMockContract(underlying, 145, 'put', exp2),
    createMockContract(underlying, 150, 'put', exp2),
    createMockContract(underlying, 155, 'put', exp2),
    createMockContract(underlying, 160, 'put', exp2),
  ]);

  return {
    underlying,
    underlyingPrice: 155.5,
    expirations: [exp1, exp2],
    contracts,
    asOf: new Date(),
  };
}

// ============================================================================
// Mock Adapter
// ============================================================================

function createMockAdapter(overrides: Partial<BrokerAdapter> = {}): BrokerAdapter {
  return {
    brokerType: 'tradier',
    brokerName: 'Tradier',
    getAccountSummary: vi.fn().mockResolvedValue({
      netLiquidation: 100000,
      buyingPower: 50000,
      cash: 30000,
      dailyPnL: 250,
      unrealizedPnL: 1500,
      currency: 'USD',
      asOf: new Date(),
    }),
    getPositions: vi.fn().mockResolvedValue([]),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOrder: vi.fn().mockResolvedValue(null),
    placeOrder: vi.fn().mockResolvedValue({ id: 'new-order' }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getQuote: vi.fn().mockResolvedValue({
      symbol: 'AAPL',
      bid: 154,
      ask: 156,
      mid: 155,
      last: 155,
      bidSize: 100,
      askSize: 100,
      volume: 1000000,
      asOf: new Date(),
    }),
    getOptionChain: vi.fn().mockResolvedValue(createMockOptionChain('AAPL')),
    getHistoricalBars: vi.fn().mockResolvedValue({
      symbol: 'AAPL',
      interval: 'daily',
      bars: [],
      asOf: new Date(),
    }),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as BrokerAdapter;
}

// ============================================================================
// Tests
// ============================================================================

describe('Option Chain Tool', () => {
  describe('GetOptionChainInputSchema', () => {
    it('should accept valid input with required symbol', () => {
      const input = { symbol: 'AAPL' };
      const result = GetOptionChainInputSchema.parse(input);
      expect(result.symbol).toBe('AAPL');
    });

    it('should accept input with all optional parameters', () => {
      const input = {
        symbol: 'SPY',
        minDTE: 7,
        maxDTE: 45,
        minStrike: 400,
        maxStrike: 500,
      };
      const result = GetOptionChainInputSchema.parse(input);
      expect(result.symbol).toBe('SPY');
      expect(result.minDTE).toBe(7);
      expect(result.maxDTE).toBe(45);
      expect(result.minStrike).toBe(400);
      expect(result.maxStrike).toBe(500);
    });

    it('should reject empty symbol', () => {
      expect(() => GetOptionChainInputSchema.parse({ symbol: '' })).toThrow();
    });

    it('should reject negative minDTE', () => {
      expect(() => GetOptionChainInputSchema.parse({ symbol: 'AAPL', minDTE: -1 })).toThrow();
    });

    it('should reject non-positive maxDTE', () => {
      expect(() => GetOptionChainInputSchema.parse({ symbol: 'AAPL', maxDTE: 0 })).toThrow();
    });

    it('should reject non-positive strike prices', () => {
      expect(() => GetOptionChainInputSchema.parse({ symbol: 'AAPL', minStrike: 0 })).toThrow();
      expect(() => GetOptionChainInputSchema.parse({ symbol: 'AAPL', maxStrike: -100 })).toThrow();
    });
  });

  describe('buildOptionChainSnapshot', () => {
    it('should build a complete option chain snapshot', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      // Verify underlying info
      expect(snapshot.underlying).toBe('AAPL');
      expect(snapshot.underlyingPrice).toBe(155.5);

      // Verify expirations
      expect(snapshot.expirations.length).toBe(2);
      expect(snapshot.expirations[0].daysToExpiration).toBeLessThan(
        snapshot.expirations[1].daysToExpiration
      );

      // Verify contracts are split by type
      const firstExp = snapshot.expirations[0];
      expect(firstExp.calls.length).toBe(3);
      expect(firstExp.puts.length).toBe(3);

      // Verify calls are sorted by strike
      expect(firstExp.calls[0].strike).toBeLessThan(firstExp.calls[1].strike);

      // Verify puts are sorted by strike
      expect(firstExp.puts[0].strike).toBeLessThan(firstExp.puts[1].strike);

      // Verify summary
      expect(snapshot.summary.totalExpirations).toBe(2);
      expect(snapshot.summary.totalContracts).toBe(14);
      expect(snapshot.summary.callCount).toBe(7);
      expect(snapshot.summary.putCount).toBe(7);
    });

    it('should include liquidity metrics for all contracts', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      const firstContract = snapshot.expirations[0].calls[0];
      expect(firstContract.liquidity).toBeDefined();
      expect(firstContract.liquidity.spread).toBeGreaterThanOrEqual(0);
      expect(firstContract.liquidity.spreadPercent).toBeDefined();
      expect(firstContract.liquidity.rating).toBeDefined();
      expect(firstContract.liquidity.lowLiquidityWarning).toBeDefined();
      expect(firstContract.liquidity.description).toBeDefined();
    });

    it('should include Greeks when available', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      const firstContract = snapshot.expirations[0].calls[0];
      expect(firstContract.greeks).toBeDefined();
      expect(firstContract.greeks!.delta).toBe(0.45);
      expect(firstContract.greeks!.gamma).toBe(0.05);
      expect(firstContract.greeks!.theta).toBe(-0.02);
      expect(firstContract.greeks!.vega).toBe(0.15);
      expect(firstContract.greeks!.impliedVolatility).toBe(0.35);
    });

    it('should handle contracts without Greeks', async () => {
      const chainNoGreeks = createMockOptionChain('AAPL');
      // Remove greeks from all contracts
      for (const [, contracts] of chainNoGreeks.contracts) {
        for (const contract of contracts) {
          delete contract.greeks;
        }
      }

      const adapter = createMockAdapter({
        getOptionChain: vi.fn().mockResolvedValue(chainNoGreeks),
      });

      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      const firstContract = snapshot.expirations[0].calls[0];
      expect(firstContract.greeks).toBeUndefined();
    });

    it('should format dates as ISO strings', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      // Check dataTimestamp is ISO string
      expect(snapshot.dataTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Check expiration is ISO string
      expect(snapshot.expirations[0].expiration).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Check contract expiration is ISO string
      expect(snapshot.expirations[0].calls[0].expiration).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include request parameters in response', async () => {
      const adapter = createMockAdapter();
      const input: GetOptionChainInput = {
        symbol: 'AAPL',
        minDTE: 7,
        maxDTE: 45,
      };

      const snapshot = await buildOptionChainSnapshot(adapter, input);

      expect(snapshot.request.symbol).toBe('AAPL');
      expect(snapshot.request.minDTE).toBe(7);
      expect(snapshot.request.maxDTE).toBe(45);
    });

    it('should include data source information', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      expect(snapshot.dataSources).toHaveLength(1);
      expect(snapshot.dataSources[0].source).toContain('Tradier');
      expect(snapshot.dataSources[0].source).toContain('tradier');
      expect(snapshot.dataSources[0].retrievedAt).toBeDefined();
    });

    it('should handle empty option chain', async () => {
      const emptyChain: OptionChain = {
        underlying: 'XYZ',
        underlyingPrice: 100,
        expirations: [],
        contracts: new Map(),
        asOf: new Date(),
      };

      const adapter = createMockAdapter({
        getOptionChain: vi.fn().mockResolvedValue(emptyChain),
      });

      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'XYZ' });

      expect(snapshot.underlying).toBe('XYZ');
      expect(snapshot.expirations).toHaveLength(0);
      expect(snapshot.summary.totalContracts).toBe(0);
      expect(snapshot.summary.totalExpirations).toBe(0);
    });

    it('should calculate DTE correctly', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      // First expiration should be ~7 days
      expect(snapshot.expirations[0].daysToExpiration).toBeGreaterThanOrEqual(6);
      expect(snapshot.expirations[0].daysToExpiration).toBeLessThanOrEqual(8);

      // Second expiration should be ~30 days
      expect(snapshot.expirations[1].daysToExpiration).toBeGreaterThanOrEqual(29);
      expect(snapshot.expirations[1].daysToExpiration).toBeLessThanOrEqual(31);
    });

    it('should include per-expiration summary', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      const expSummary = snapshot.expirations[0].summary;
      expect(expSummary.totalContracts).toBe(6);
      expect(expSummary.callCount).toBe(3);
      expect(expSummary.putCount).toBe(3);
      expect(expSummary.averageSpreadPercent).toBeGreaterThanOrEqual(0);
    });

    it('should count liquidity ratings in summary', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      const totalRatings =
        snapshot.summary.highLiquidityCount +
        snapshot.summary.mediumLiquidityCount +
        snapshot.summary.lowLiquidityCount +
        snapshot.summary.veryLowLiquidityCount;

      expect(totalRatings).toBe(snapshot.summary.totalContracts);
    });

    it('should track DTE range in summary', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      expect(snapshot.summary.minDTE).toBeGreaterThanOrEqual(0);
      expect(snapshot.summary.maxDTE).toBeGreaterThan(snapshot.summary.minDTE);
    });
  });

  describe('createOptionChainTool', () => {
    it('should create a valid MCP tool definition', () => {
      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createOptionChainTool(context);

      expect(tool.name).toBe('get_option_chain');
      expect(tool.description).toContain('option chain');
      expect(tool.description).toContain('liquidity');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it('should execute successfully when connected', async () => {
      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createOptionChainTool(context);
      const result = await tool.handler({ symbol: 'AAPL' });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.underlying).toBe('AAPL');
      expect(result.metadata!.contractCount).toBe(14);
    });

    it('should return error when not connected', async () => {
      const context: OptionChainToolContext = {
        adapter: null,
      };

      const tool = createOptionChainTool(context);
      const result = await tool.handler({ symbol: 'AAPL' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not connected');
    });

    it('should return error for invalid input', async () => {
      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createOptionChainTool(context);
      const result = await tool.handler({ symbol: '' }); // Invalid: empty symbol

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to retrieve option chain');
    });

    it('should handle adapter errors gracefully', async () => {
      const adapter = createMockAdapter({
        getOptionChain: vi.fn().mockRejectedValue(new Error('Rate limit exceeded')),
      });

      const context: OptionChainToolContext = { adapter };
      const tool = createOptionChainTool(context);
      const result = await tool.handler({ symbol: 'AAPL' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('should include metadata in successful response', async () => {
      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createOptionChainTool(context);
      const result = await tool.handler({ symbol: 'AAPL' });

      expect(result.success).toBe(true);
      expect(result.metadata!.underlying).toBe('AAPL');
      expect(result.metadata!.underlyingPrice).toBe(155.5);
      expect(result.metadata!.expirationCount).toBe(2);
      expect(result.metadata!.contractCount).toBe(14);
      expect(result.metadata!.callCount).toBe(7);
      expect(result.metadata!.putCount).toBe(7);
    });

    it('should accept input with DTE filters', async () => {
      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createOptionChainTool(context);
      const result = await tool.handler({
        symbol: 'AAPL',
        minDTE: 0,
        maxDTE: 45,
      });

      expect(result.success).toBe(true);
    });

    it('should use custom liquidity config when provided', async () => {
      const customConfig = {
        lowLiquidityThreshold: 10,
        mediumLiquidityThreshold: 5,
        highLiquidityThreshold: 2,
        minVolumeForGoodLiquidity: 50,
        minOpenInterestForGoodLiquidity: 100,
      };

      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
        liquidityConfig: customConfig,
      };

      const tool = createOptionChainTool(context);
      const result = await tool.handler({ symbol: 'AAPL' });

      expect(result.success).toBe(true);
    });
  });

  describe('getOptionChain (standalone function)', () => {
    it('should return option chain snapshot', async () => {
      const adapter = createMockAdapter();
      const snapshot = await getOptionChain(adapter, { symbol: 'AAPL' });

      expect(snapshot.underlying).toBe('AAPL');
      expect(snapshot.expirations).toBeDefined();
      expect(snapshot.summary).toBeDefined();
      expect(snapshot.dataTimestamp).toBeDefined();
    });

    it('should pass through request parameters', async () => {
      const adapter = createMockAdapter();
      const snapshot = await getOptionChain(adapter, {
        symbol: 'SPY',
        minDTE: 7,
        maxDTE: 30,
      });

      expect(snapshot.request.symbol).toBe('SPY');
      expect(snapshot.request.minDTE).toBe(7);
      expect(snapshot.request.maxDTE).toBe(30);
    });
  });

  describe('Tool Registry Integration', () => {
    it('should register and execute option chain tool', async () => {
      const registry = new ToolRegistry();
      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createOptionChainTool(context);
      registry.register(tool);

      // Verify registration
      expect(registry.get('get_option_chain')).toBeDefined();

      // Execute via registry
      const result = await registry.execute('get_option_chain', { symbol: 'AAPL' });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should validate input via registry', async () => {
      const registry = new ToolRegistry();
      const context: OptionChainToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createOptionChainTool(context);
      registry.register(tool);

      // Execute with missing required parameter
      const result = await registry.execute('get_option_chain', {});

      expect(result.success).toBe(false);
      // Zod returns "Required" for missing fields when executed via registry
      expect(result.error).toMatch(/symbol|Required/i);
    });
  });

  describe('Low Liquidity Handling', () => {
    it('should flag low liquidity contracts', async () => {
      // Create chain with wide spreads
      const chainWithWideSpreads = createMockOptionChain('AAPL');
      for (const [, contracts] of chainWithWideSpreads.contracts) {
        for (const contract of contracts) {
          contract.bid = 1.0;
          contract.ask = 2.0; // 66% spread
          contract.mid = 1.5;
        }
      }

      const adapter = createMockAdapter({
        getOptionChain: vi.fn().mockResolvedValue(chainWithWideSpreads),
      });

      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      // All contracts should have low liquidity warnings
      expect(snapshot.summary.lowLiquidityWarningCount).toBe(14);
    });

    it('should identify high liquidity contracts', async () => {
      // Create chain with tight spreads and high volume/OI
      const chainWithTightSpreads = createMockOptionChain('AAPL');
      for (const [, contracts] of chainWithTightSpreads.contracts) {
        for (const contract of contracts) {
          contract.bid = 2.49;
          contract.ask = 2.51; // ~0.8% spread
          contract.mid = 2.5;
          contract.volume = 1000;
          contract.openInterest = 5000;
        }
      }

      const adapter = createMockAdapter({
        getOptionChain: vi.fn().mockResolvedValue(chainWithTightSpreads),
      });

      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      // All contracts should be high liquidity
      expect(snapshot.summary.highLiquidityCount).toBe(14);
      expect(snapshot.summary.lowLiquidityWarningCount).toBe(0);
    });
  });

  describe('Contract Sorting', () => {
    it('should sort expirations by DTE ascending', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      for (let i = 1; i < snapshot.expirations.length; i++) {
        expect(snapshot.expirations[i - 1].daysToExpiration).toBeLessThanOrEqual(
          snapshot.expirations[i].daysToExpiration
        );
      }
    });

    it('should sort contracts by strike ascending within each expiration', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildOptionChainSnapshot(adapter, { symbol: 'AAPL' });

      for (const exp of snapshot.expirations) {
        for (let i = 1; i < exp.calls.length; i++) {
          expect(exp.calls[i - 1].strike).toBeLessThanOrEqual(exp.calls[i].strike);
        }
        for (let i = 1; i < exp.puts.length; i++) {
          expect(exp.puts[i - 1].strike).toBeLessThanOrEqual(exp.puts[i].strike);
        }
      }
    });
  });
});
