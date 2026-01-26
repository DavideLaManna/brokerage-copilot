/**
 * Tests for Portfolio Snapshot Tool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrokerAdapter, AccountSummary, Position, Order, Greeks } from '../types/broker.js';
import {
  buildPortfolioSnapshot,
  createPortfolioSnapshotTool,
  getPortfolioSnapshot,
  type PortfolioSnapshotToolContext,
} from './portfolio-snapshot.js';
import { ToolRegistry } from './registry.js';

// ============================================================================
// Mock Data
// ============================================================================

const mockAccountSummary: AccountSummary = {
  netLiquidation: 100000,
  buyingPower: 50000,
  cash: 30000,
  dailyPnL: 250,
  unrealizedPnL: 1500,
  currency: 'USD',
  asOf: new Date('2026-01-26T10:00:00Z'),
};

const mockGreeks: Greeks = {
  delta: 0.45,
  gamma: 0.05,
  theta: -0.02,
  vega: 0.15,
  impliedVolatility: 0.35,
};

const mockPositions: Position[] = [
  {
    id: 'pos-1',
    symbol: 'AAPL',
    quantity: 100,
    averageCost: 150,
    currentPrice: 155,
    marketValue: 15500,
    unrealizedPnL: 500,
    unrealizedPnLPercent: 3.33,
    assetClass: 'equity',
  },
  {
    id: 'pos-2',
    symbol: 'AAPL240216C00185000',
    quantity: 5,
    averageCost: 3.5,
    currentPrice: 4.2,
    marketValue: 2100,
    unrealizedPnL: 350,
    unrealizedPnLPercent: 20,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'AAPL240216C00185000',
      underlying: 'AAPL',
      strike: 185,
      expiration: new Date('2026-02-16'),
      optionType: 'call',
      multiplier: 100,
      greeks: mockGreeks,
    },
  },
  {
    id: 'pos-3',
    symbol: 'TSLA240216P00250000',
    quantity: -3,
    averageCost: 8.0,
    currentPrice: 6.5,
    marketValue: -1950,
    unrealizedPnL: 450,
    unrealizedPnLPercent: 18.75,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'TSLA240216P00250000',
      underlying: 'TSLA',
      strike: 250,
      expiration: new Date('2026-02-16'),
      optionType: 'put',
      multiplier: 100,
      greeks: {
        delta: -0.35,
        gamma: 0.04,
        theta: -0.03,
        vega: 0.12,
        impliedVolatility: 0.45,
      },
    },
  },
];

const mockOrders: Order[] = [
  {
    id: 'order-1',
    symbol: 'AAPL',
    assetClass: 'equity',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'day',
    quantity: 50,
    limitPrice: 150,
    filledQuantity: 0,
    status: 'open',
    submittedAt: new Date('2026-01-26T09:30:00Z'),
  },
  {
    id: 'order-2',
    symbol: 'NVDA240216C00500000',
    assetClass: 'option',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'gtc',
    quantity: 2,
    limitPrice: 15.5,
    filledQuantity: 0,
    status: 'open',
    submittedAt: new Date('2026-01-26T10:15:00Z'),
    optionDetails: {
      optionSymbol: 'NVDA240216C00500000',
      underlying: 'NVDA',
      strike: 500,
      expiration: new Date('2026-02-16'),
      optionType: 'call',
      multiplier: 100,
    },
  },
];

// ============================================================================
// Mock Adapter
// ============================================================================

function createMockAdapter(overrides: Partial<BrokerAdapter> = {}): BrokerAdapter {
  return {
    brokerType: 'tradier',
    brokerName: 'Tradier',
    getAccountSummary: vi.fn().mockResolvedValue(mockAccountSummary),
    getPositions: vi.fn().mockResolvedValue(mockPositions),
    getOpenOrders: vi.fn().mockResolvedValue(mockOrders),
    getOrder: vi.fn().mockResolvedValue(null),
    placeOrder: vi.fn().mockResolvedValue({ id: 'new-order' }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getQuote: vi.fn().mockResolvedValue({ symbol: 'AAPL', bid: 154, ask: 156, mid: 155, last: 155, bidSize: 100, askSize: 100, volume: 1000000, asOf: new Date() }),
    getOptionChain: vi.fn().mockResolvedValue({ underlying: 'AAPL', underlyingPrice: 155, expirations: [], contracts: new Map(), asOf: new Date() }),
    getHistoricalBars: vi.fn().mockResolvedValue({ symbol: 'AAPL', interval: 'daily', bars: [], asOf: new Date() }),
    validateConnection: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as BrokerAdapter;
}

// ============================================================================
// Tests
// ============================================================================

describe('Portfolio Snapshot Tool', () => {
  describe('buildPortfolioSnapshot', () => {
    it('should build a complete portfolio snapshot', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter);

      // Verify account summary
      expect(snapshot.account.netLiquidation).toBe(100000);
      expect(snapshot.account.buyingPower).toBe(50000);
      expect(snapshot.account.cash).toBe(30000);
      expect(snapshot.account.dailyPnL).toBe(250);
      expect(snapshot.account.currency).toBe('USD');

      // Verify positions
      expect(snapshot.positions).toHaveLength(3);

      // Verify equity position
      const equityPos = snapshot.positions.find(p => p.id === 'pos-1');
      expect(equityPos).toBeDefined();
      expect(equityPos!.symbol).toBe('AAPL');
      expect(equityPos!.assetClass).toBe('equity');
      expect(equityPos!.quantity).toBe(100);
      expect(equityPos!.underlying).toBe('AAPL');

      // Verify option position with Greeks
      const optionPos = snapshot.positions.find(p => p.id === 'pos-2');
      expect(optionPos).toBeDefined();
      expect(optionPos!.assetClass).toBe('option');
      expect(optionPos!.underlying).toBe('AAPL');
      expect(optionPos!.optionDetails).toBeDefined();
      expect(optionPos!.optionDetails!.strike).toBe(185);
      expect(optionPos!.optionDetails!.optionType).toBe('call');
      expect(optionPos!.greeks).toBeDefined();
      expect(optionPos!.greeks!.delta).toBe(0.45);

      // Verify orders
      expect(snapshot.orders).toHaveLength(2);
      const equityOrder = snapshot.orders.find(o => o.id === 'order-1');
      expect(equityOrder).toBeDefined();
      expect(equityOrder!.side).toBe('buy');
      expect(equityOrder!.orderType).toBe('limit');

      // Verify option order
      const optionOrder = snapshot.orders.find(o => o.id === 'order-2');
      expect(optionOrder).toBeDefined();
      expect(optionOrder!.optionDetails).toBeDefined();
      expect(optionOrder!.optionDetails!.strike).toBe(500);

      // Verify exposure by underlying
      expect(snapshot.exposureByUnderlying.length).toBeGreaterThan(0);
      const aaplExposure = snapshot.exposureByUnderlying.find(e => e.symbol === 'AAPL');
      expect(aaplExposure).toBeDefined();
      expect(aaplExposure!.positionCount).toBe(2); // 1 equity + 1 option

      // Verify portfolio Greeks
      expect(snapshot.portfolioGreeks.delta).toBeDefined();
      expect(snapshot.portfolioGreeks.theta).toBeDefined();
      expect(snapshot.portfolioGreeks.positionsWithGreeks).toBeGreaterThan(0);
      expect(snapshot.portfolioGreeks.interpretations).toBeDefined();

      // Verify summary
      expect(snapshot.summary.totalPositions).toBe(3);
      expect(snapshot.summary.optionPositions).toBe(2);
      expect(snapshot.summary.equityPositions).toBe(1);
      expect(snapshot.summary.openOrders).toBe(2);

      // Verify timestamps
      expect(snapshot.dataTimestamp).toBeDefined();
      expect(snapshot.dataSources).toHaveLength(1);
      expect(snapshot.dataSources[0].source).toContain('Tradier');
    });

    it('should handle empty positions', async () => {
      const adapter = createMockAdapter({
        getPositions: vi.fn().mockResolvedValue([]),
        getOpenOrders: vi.fn().mockResolvedValue([]),
      });

      const snapshot = await buildPortfolioSnapshot(adapter);

      expect(snapshot.positions).toHaveLength(0);
      expect(snapshot.orders).toHaveLength(0);
      expect(snapshot.exposureByUnderlying).toHaveLength(0);
      expect(snapshot.summary.totalPositions).toBe(0);
      expect(snapshot.summary.optionPositions).toBe(0);
      expect(snapshot.summary.equityPositions).toBe(0);
    });

    it('should apply custom concentration limit', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter, { concentrationLimit: 5 });

      // With 5% limit, some underlyings may exceed
      expect(snapshot.exposureByUnderlying).toBeDefined();
    });

    it('should calculate DTE correctly for options', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter);

      const optionPos = snapshot.positions.find(p => p.assetClass === 'option');
      expect(optionPos).toBeDefined();
      expect(optionPos!.optionDetails).toBeDefined();
      expect(optionPos!.optionDetails!.daysToExpiration).toBeGreaterThanOrEqual(0);
    });

    it('should handle positions without Greeks', async () => {
      const positionsNoGreeks: Position[] = [
        {
          id: 'pos-no-greeks',
          symbol: 'SPY240216C00500000',
          quantity: 2,
          averageCost: 5,
          currentPrice: 5.5,
          marketValue: 1100,
          unrealizedPnL: 100,
          unrealizedPnLPercent: 10,
          assetClass: 'option',
          optionDetails: {
            optionSymbol: 'SPY240216C00500000',
            underlying: 'SPY',
            strike: 500,
            expiration: new Date('2026-02-16'),
            optionType: 'call',
            multiplier: 100,
            // No greeks
          },
        },
      ];

      const adapter = createMockAdapter({
        getPositions: vi.fn().mockResolvedValue(positionsNoGreeks),
      });

      const snapshot = await buildPortfolioSnapshot(adapter);

      expect(snapshot.positions[0].greeks).toBeUndefined();
      expect(snapshot.portfolioGreeks.positionsWithoutGreeks).toBe(1);
    });
  });

  describe('createPortfolioSnapshotTool', () => {
    it('should create a valid MCP tool definition', () => {
      const context: PortfolioSnapshotToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createPortfolioSnapshotTool(context);

      expect(tool.name).toBe('get_portfolio_snapshot');
      expect(tool.description).toContain('portfolio snapshot');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it('should execute successfully when connected', async () => {
      const context: PortfolioSnapshotToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createPortfolioSnapshotTool(context);
      const result = await tool.handler({});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.positionCount).toBe(3);
      expect(result.metadata!.orderCount).toBe(2);
    });

    it('should return error when not connected', async () => {
      const context: PortfolioSnapshotToolContext = {
        adapter: null,
      };

      const tool = createPortfolioSnapshotTool(context);
      const result = await tool.handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not connected');
    });

    it('should handle adapter errors gracefully', async () => {
      const adapter = createMockAdapter({
        getPositions: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      });

      const context: PortfolioSnapshotToolContext = { adapter };
      const tool = createPortfolioSnapshotTool(context);
      const result = await tool.handler({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection timeout');
    });

    it('should accept valid input parameters', async () => {
      const context: PortfolioSnapshotToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createPortfolioSnapshotTool(context);
      const result = await tool.handler({ concentrationLimit: 15 });

      expect(result.success).toBe(true);
    });
  });

  describe('getPortfolioSnapshot (standalone function)', () => {
    it('should return portfolio snapshot', async () => {
      const adapter = createMockAdapter();
      const snapshot = await getPortfolioSnapshot(adapter);

      expect(snapshot.account).toBeDefined();
      expect(snapshot.positions).toBeDefined();
      expect(snapshot.orders).toBeDefined();
      expect(snapshot.exposureByUnderlying).toBeDefined();
      expect(snapshot.portfolioGreeks).toBeDefined();
    });
  });

  describe('Tool Registry Integration', () => {
    it('should register and execute portfolio snapshot tool', async () => {
      const registry = new ToolRegistry();
      const context: PortfolioSnapshotToolContext = {
        adapter: createMockAdapter(),
      };

      const tool = createPortfolioSnapshotTool(context);
      registry.register(tool);

      // Verify registration
      expect(registry.get('get_portfolio_snapshot')).toBeDefined();
      expect(registry.list()).toHaveLength(1);

      // Execute via registry
      const result = await registry.execute('get_portfolio_snapshot', {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should return error for unknown tool', async () => {
      const registry = new ToolRegistry();
      const result = await registry.execute('unknown_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('Snapshot Data Format', () => {
    it('should format dates as ISO strings', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter);

      // Check dataTimestamp is ISO string
      expect(snapshot.dataTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Check order submittedAt is ISO string
      expect(snapshot.orders[0].submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Check option expiration is ISO string
      const optionPos = snapshot.positions.find(p => p.optionDetails);
      expect(optionPos!.optionDetails!.expiration).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include data source information', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter);

      expect(snapshot.dataSources).toHaveLength(1);
      expect(snapshot.dataSources[0].source).toContain('Tradier');
      expect(snapshot.dataSources[0].source).toContain('tradier');
      expect(snapshot.dataSources[0].retrievedAt).toBeDefined();
    });

    it('should calculate summary totals correctly', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter);

      // Total market value = 15500 + 2100 + (-1950) = 15650
      expect(snapshot.summary.totalMarketValue).toBe(15650);

      // Total unrealized P&L = 500 + 350 + 450 = 1300
      expect(snapshot.summary.totalUnrealizedPnL).toBe(1300);
    });
  });

  describe('Greeks Interpretations', () => {
    it('should include portfolio Greeks interpretations', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter);

      expect(snapshot.portfolioGreeks.interpretations).toBeDefined();
      expect(Array.isArray(snapshot.portfolioGreeks.interpretations)).toBe(true);
    });
  });

  describe('Exposure Calculations', () => {
    it('should calculate exposure by underlying', async () => {
      const adapter = createMockAdapter();
      const snapshot = await buildPortfolioSnapshot(adapter);

      // Should have AAPL and TSLA underlyings
      const underlyings = snapshot.exposureByUnderlying.map(e => e.symbol);
      expect(underlyings).toContain('AAPL');
      expect(underlyings).toContain('TSLA');

      // AAPL should have 2 positions (equity + option)
      const aaplExposure = snapshot.exposureByUnderlying.find(e => e.symbol === 'AAPL');
      expect(aaplExposure!.positionCount).toBe(2);
    });

    it('should flag underlyings exceeding concentration limit', async () => {
      const adapter = createMockAdapter();
      // Use a very low concentration limit to trigger warnings
      const snapshot = await buildPortfolioSnapshot(adapter, { concentrationLimit: 1 });

      // Check if any underlyings exceed the limit
      const exceeding = snapshot.exposureByUnderlying.filter(e => e.exceedsLimit);
      expect(snapshot.summary.underlyingsExceedingLimit).toBe(exceeding.length);
    });
  });
});
