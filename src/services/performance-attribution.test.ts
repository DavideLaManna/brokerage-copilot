/**
 * Performance Attribution Service Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  PerformanceAttributionService,
  createPerformanceAttributionService,
} from './performance-attribution.js';
import type {
  ClosedTrade,
  StoredClosedTrade,
  PerformanceMetrics,
  PerformanceAttribution,
  CatalystCategory,
} from '../types/performance.js';
import type { StrategyType } from '../types/trade-proposal.js';

describe('PerformanceAttributionService', () => {
  const testDir = '.config/test-performance';
  const testPassword = 'test-password-12345678';
  const testAccountId = 'test-account';

  let service: PerformanceAttributionService;

  beforeEach(async () => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }

    service = createPerformanceAttributionService(
      {
        masterPassword: testPassword,
        dataDir: testDir,
        minPatternSampleSize: 2,
        breakevenThreshold: 1,
      },
      {
        info: () => {},
        warn: () => {},
        error: () => {},
      }
    );

    await service.initialize();
  });

  afterEach(async () => {
    service.clearMemory();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  // ===========================================================================
  // Constructor and Initialization Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should throw error if password is too short', () => {
      expect(() =>
        createPerformanceAttributionService({
          masterPassword: 'short',
          dataDir: testDir,
        })
      ).toThrow('Master password must be at least 8 characters');
    });

    it('should initialize successfully with valid options', async () => {
      const newService = createPerformanceAttributionService({
        masterPassword: testPassword,
        dataDir: testDir,
      });

      await newService.initialize();
      expect(newService.getTotalTradeCount()).toBe(0);
    });
  });

  // ===========================================================================
  // Trade Recording Tests
  // ===========================================================================

  describe('recordTrade', () => {
    it('should record a trade and calculate derived values', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 5,
        entryDate: new Date('2024-01-15'),
        entryPrice: 5.00,
        entryCost: 2500,
        exitDate: new Date('2024-01-20'),
        exitPrice: 7.50,
        exitProceeds: 3750,
      });

      expect(trade.id).toBeDefined();
      expect(trade.underlying).toBe('AAPL');
      expect(trade.realizedPnL).toBe(1250); // 3750 - 2500
      expect(trade.realizedPnLPercent).toBe(50); // 1250 / 2500 * 100
      expect(trade.outcome).toBe('win');
      expect(trade.holdDays).toBe(5);
      expect(trade.holdDurationBucket).toBe('1_week'); // 4-7 days = 1 week
      expect(trade.dteBucket).toBe('14-30');
    });

    it('should calculate net P&L after commission and fees', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'technical',
        contracts: 1,
        entryDate: new Date('2024-01-15'),
        entryPrice: 5.00,
        entryCost: 500,
        exitDate: new Date('2024-01-20'),
        exitPrice: 6.00,
        exitProceeds: 600,
        commission: 10,
        fees: 2.50,
      });

      expect(trade.realizedPnL).toBe(100); // 600 - 500
      expect(trade.netPnL).toBe(87.5); // 100 - 10 - 2.50
    });

    it('should record a losing trade', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'TSLA',
        strategyType: 'long_put',
        dteAtEntry: 14,
        catalyst: 'news',
        contracts: 2,
        entryDate: new Date('2024-01-15'),
        entryPrice: 3.00,
        entryCost: 600,
        exitDate: new Date('2024-01-16'),
        exitPrice: 1.50,
        exitProceeds: 300,
      });

      expect(trade.realizedPnL).toBe(-300);
      expect(trade.outcome).toBe('loss');
    });

    it('should normalize underlying to uppercase', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'aapl',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'none',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 5.5,
        exitProceeds: 550,
      });

      expect(trade.underlying).toBe('AAPL');
    });

    it('should include optional fields when provided', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
        confidence: 'high',
        proposalId: '550e8400-e29b-41d4-a716-446655440000',
        notes: 'Test trade',
        tags: ['test', 'earnings'],
      });

      expect(trade.confidence).toBe('high');
      expect(trade.proposalId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(trade.notes).toBe('Test trade');
      expect(trade.tags).toContain('test');
    });
  });

  // ===========================================================================
  // Trade Update and Delete Tests
  // ===========================================================================

  describe('updateTrade', () => {
    it('should update trade notes', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'technical',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
      });

      const updated = await service.updateTrade(testAccountId, trade.id, {
        notes: 'Updated notes',
      });

      expect(updated?.notes).toBe('Updated notes');
    });

    it('should update trade tags', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'technical',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
      });

      const updated = await service.updateTrade(testAccountId, trade.id, {
        tags: ['new-tag'],
      });

      expect(updated?.tags).toContain('new-tag');
    });

    it('should return null for non-existent trade', async () => {
      const result = await service.updateTrade(testAccountId, 'non-existent', {
        notes: 'Test',
      });

      expect(result).toBeNull();
    });
  });

  describe('deleteTrade', () => {
    it('should delete a trade', async () => {
      const trade = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'technical',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
      });

      expect(service.getTradeCount(testAccountId)).toBe(1);

      const deleted = await service.deleteTrade(testAccountId, trade.id);

      expect(deleted).toBe(true);
      expect(service.getTradeCount(testAccountId)).toBe(0);
    });

    it('should return false for non-existent trade', async () => {
      const result = await service.deleteTrade(testAccountId, 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('getTrade', () => {
    it('should retrieve a trade by ID', async () => {
      const recorded = await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'technical',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
      });

      const trade = service.getTrade(testAccountId, recorded.id);

      expect(trade).not.toBeNull();
      expect(trade?.id).toBe(recorded.id);
    });

    it('should return null for non-existent trade', () => {
      const trade = service.getTrade(testAccountId, 'non-existent');

      expect(trade).toBeNull();
    });
  });

  // ===========================================================================
  // Query Tests
  // ===========================================================================

  describe('query', () => {
    beforeEach(async () => {
      // Record a mix of trades for testing
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-10'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-15'),
        exitPrice: 6,
        exitProceeds: 600,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'TSLA',
        strategyType: 'long_put',
        dteAtEntry: 14,
        catalyst: 'technical',
        contracts: 2,
        entryDate: new Date('2024-01-20'),
        entryPrice: 3,
        entryCost: 600,
        exitDate: new Date('2024-01-25'),
        exitPrice: 2,
        exitProceeds: 400,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 45,
        catalyst: 'earnings',
        contracts: 3,
        entryDate: new Date('2024-02-01'),
        entryPrice: 4,
        entryCost: 1200,
        exitDate: new Date('2024-02-10'),
        exitPrice: 5,
        exitProceeds: 1500,
      });
    });

    it('should query all trades', () => {
      const result = service.query(testAccountId);

      expect(result.totalCount).toBe(3);
      expect(result.trades).toHaveLength(3);
    });

    it('should filter by underlying', () => {
      const result = service.query(testAccountId, {
        underlyings: ['AAPL'],
      });

      expect(result.totalCount).toBe(2);
      expect(result.trades.every(t => t.underlying === 'AAPL')).toBe(true);
    });

    it('should filter by strategy type', () => {
      const result = service.query(testAccountId, {
        strategyTypes: ['long_put'],
      });

      expect(result.totalCount).toBe(1);
      expect(result.trades[0]?.strategyType).toBe('long_put');
    });

    it('should filter by catalyst', () => {
      const result = service.query(testAccountId, {
        catalysts: ['earnings'],
      });

      expect(result.totalCount).toBe(2);
    });

    it('should filter by outcome', () => {
      const result = service.query(testAccountId, {
        outcomes: ['loss'],
      });

      expect(result.totalCount).toBe(1);
      expect(result.trades[0]?.underlying).toBe('TSLA');
    });

    it('should filter by date range', () => {
      const result = service.query(testAccountId, {
        startDate: new Date('2024-01-20'),
        endDate: new Date('2024-01-31'),
      });

      expect(result.totalCount).toBe(1);
    });

    it('should sort by P&L', () => {
      const result = service.query(testAccountId, {
        sortBy: 'realizedPnL',
        sortOrder: 'desc',
      });

      expect(result.trades[0]?.realizedPnL).toBeGreaterThan(
        result.trades[result.trades.length - 1]!.realizedPnL
      );
    });

    it('should paginate results', () => {
      const result = service.query(testAccountId, {
        limit: 2,
        offset: 0,
      });

      expect(result.trades).toHaveLength(2);
      expect(result.totalCount).toBe(3);
      expect(result.hasMore).toBe(true);
    });
  });

  // ===========================================================================
  // Performance Attribution Tests
  // ===========================================================================

  describe('getPerformanceAttribution', () => {
    beforeEach(async () => {
      // Record trades with different characteristics
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-10'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-15'),
        exitPrice: 7,
        exitProceeds: 700,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 20,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-20'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-25'),
        exitPrice: 6.5,
        exitProceeds: 650,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'TSLA',
        strategyType: 'long_put',
        dteAtEntry: 14,
        catalyst: 'technical',
        contracts: 2,
        entryDate: new Date('2024-02-01'),
        entryPrice: 3,
        entryCost: 600,
        exitDate: new Date('2024-02-05'),
        exitPrice: 2,
        exitProceeds: 400,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'MSFT',
        strategyType: 'vertical_spread',
        dteAtEntry: 45,
        catalyst: 'news',
        contracts: 1,
        entryDate: new Date('2024-02-10'),
        entryPrice: 2,
        entryCost: 200,
        exitDate: new Date('2024-02-20'),
        exitPrice: 3,
        exitProceeds: 300,
      });
    });

    it('should generate overall metrics', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      expect(attribution.overall.totalTrades).toBe(4);
      expect(attribution.overall.wins).toBe(3);
      expect(attribution.overall.losses).toBe(1);
    });

    it('should include breakdown by strategy', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      expect(attribution.byStrategy.dimension).toBe('Strategy Type');
      expect(attribution.byStrategy.byValue['long_call']).toBeDefined();
      expect(attribution.byStrategy.byValue['long_call']?.totalTrades).toBe(2);
    });

    it('should include breakdown by underlying', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      expect(attribution.byUnderlying.dimension).toBe('Underlying');
      expect(attribution.byUnderlying.byValue['AAPL']?.totalTrades).toBe(2);
    });

    it('should include breakdown by DTE bucket', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      expect(attribution.byDTEBucket.dimension).toBe('DTE Bucket');
      expect(Object.keys(attribution.byDTEBucket.byValue).length).toBeGreaterThan(0);
    });

    it('should include breakdown by catalyst', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      expect(attribution.byCatalyst.dimension).toBe('Catalyst');
      expect(attribution.byCatalyst.byValue['earnings']?.totalTrades).toBe(2);
    });

    it('should include breakdown by hold duration', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      expect(attribution.byHoldDuration.dimension).toBe('Hold Duration');
      expect(Object.keys(attribution.byHoldDuration.byValue).length).toBeGreaterThan(0);
    });

    it('should include top and worst trades', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      expect(attribution.topTrades.length).toBeGreaterThan(0);
      expect(attribution.worstTrades.length).toBeGreaterThan(0);

      // Top trade should have highest P&L
      expect(attribution.topTrades[0]?.realizedPnL).toBeGreaterThan(0);

      // Worst trade should include the losing trade
      expect(attribution.worstTrades.some(t => t.realizedPnL < 0)).toBe(true);
    });

    it('should identify best and worst performing values', () => {
      const attribution = service.getPerformanceAttribution(testAccountId);

      // Earnings has 100% win rate (2 wins out of 2)
      // Note: technical and news only have 1 trade each, so they don't meet
      // the min sample size (2) for best/worst detection
      expect(attribution.byCatalyst.bestPerforming).toBe('earnings');
      // Only earnings meets the sample size threshold, so it's both best and worst
      expect(attribution.byCatalyst.worstPerforming).toBe('earnings');
    });
  });

  // ===========================================================================
  // Metrics and Drawdown Tests
  // ===========================================================================

  describe('getMetrics', () => {
    it('should calculate metrics for filtered trades', async () => {
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'TSLA',
        strategyType: 'long_put',
        dteAtEntry: 14,
        catalyst: 'technical',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 3,
        entryCost: 300,
        exitDate: new Date(),
        exitPrice: 2,
        exitProceeds: 200,
      });

      const aaplMetrics = service.getMetrics(testAccountId, {
        underlyings: ['AAPL'],
      });

      expect(aaplMetrics.totalTrades).toBe(1);
      expect(aaplMetrics.winRate).toBe(100);
    });
  });

  describe('getDrawdownInfo', () => {
    it('should calculate drawdown information', async () => {
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-01'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-10'),
        exitPrice: 6,
        exitProceeds: 600,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-15'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-20'),
        exitPrice: 3,
        exitProceeds: 300,
      });

      const drawdown = service.getDrawdownInfo(testAccountId, 10000);

      // Started with 10000, gained 100, then lost 200 -> current = 9900
      // Peak was 10100 after first trade
      expect(drawdown.peakValue).toBe(10100);
      expect(drawdown.currentValue).toBe(9900);
      expect(drawdown.currentDrawdown).toBeLessThan(0);
    });

    it('should return zero drawdown for empty account', () => {
      const drawdown = service.getDrawdownInfo(testAccountId);

      expect(drawdown.currentDrawdown).toBe(0);
      expect(drawdown.maxDrawdown).toBe(0);
    });
  });

  describe('getEquityCurve', () => {
    it('should generate equity curve points', async () => {
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-01'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-10'),
        exitPrice: 6,
        exitProceeds: 600,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-15'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-20'),
        exitPrice: 5.5,
        exitProceeds: 550,
      });

      const curve = service.getEquityCurve(testAccountId, 10000);

      expect(curve.length).toBe(3); // Starting point + 2 trades
      expect(curve[0]?.value).toBe(10000);
      expect(curve[1]?.cumulativePnL).toBe(100);
      expect(curve[2]?.cumulativePnL).toBe(150);
    });

    it('should return empty array for no trades', () => {
      const curve = service.getEquityCurve(testAccountId);

      expect(curve).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Statistics Tests
  // ===========================================================================

  describe('getStatistics', () => {
    it('should return statistics summary', async () => {
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
      });

      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 4,
        exitProceeds: 400,
      });

      const stats = service.getStatistics(testAccountId);

      expect(stats.totalTrades).toBe(2);
      expect(stats.byOutcome.win).toBe(1);
      expect(stats.byOutcome.loss).toBe(1);
      expect(stats.byStrategy['long_call']).toBe(2);
      expect(stats.byUnderlying['AAPL']).toBe(2);
    });
  });

  // ===========================================================================
  // Persistence Tests
  // ===========================================================================

  describe('persistence', () => {
    it('should persist trades across service restarts', async () => {
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date('2024-01-10'),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date('2024-01-15'),
        exitPrice: 6,
        exitProceeds: 600,
      });

      // Clear memory and reinitialize
      service.clearMemory();
      await service.initialize();

      const count = service.getTradeCount(testAccountId);
      expect(count).toBe(1);

      const result = service.query(testAccountId);
      expect(result.trades[0]?.underlying).toBe('AAPL');
    });

    it('should handle account clearing', async () => {
      await service.recordTrade({
        accountId: testAccountId,
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
      });

      await service.clearAccount(testAccountId);

      expect(service.getTradeCount(testAccountId)).toBe(0);
    });
  });

  // ===========================================================================
  // Pattern Detection Tests
  // ===========================================================================

  describe('pattern detection', () => {
    it('should detect outperforming patterns', async () => {
      // Record trades where long_call significantly outperforms
      for (let i = 0; i < 5; i++) {
        await service.recordTrade({
          accountId: testAccountId,
          underlying: 'AAPL',
          strategyType: 'long_call',
          dteAtEntry: 30,
          catalyst: 'earnings',
          contracts: 1,
          entryDate: new Date('2024-01-10'),
          entryPrice: 5,
          entryCost: 500,
          exitDate: new Date('2024-01-15'),
          exitPrice: 6,
          exitProceeds: 600,
        });
      }

      // Record losing trades for another strategy
      for (let i = 0; i < 5; i++) {
        await service.recordTrade({
          accountId: testAccountId,
          underlying: 'TSLA',
          strategyType: 'long_put',
          dteAtEntry: 14,
          catalyst: 'technical',
          contracts: 1,
          entryDate: new Date('2024-02-01'),
          entryPrice: 3,
          entryCost: 300,
          exitDate: new Date('2024-02-05'),
          exitPrice: 2,
          exitProceeds: 200,
        });
      }

      const attribution = service.getPerformanceAttribution(testAccountId, {
        minSampleSize: 5,
      });

      // Should detect patterns
      expect(attribution.patterns.length).toBeGreaterThan(0);

      // Should identify outperformance and underperformance
      const outperformance = attribution.patterns.filter(p => p.type === 'outperformance');
      const underperformance = attribution.patterns.filter(p => p.type === 'underperformance');

      expect(outperformance.length).toBeGreaterThan(0);
      expect(underperformance.length).toBeGreaterThan(0);
    });
  });
});
