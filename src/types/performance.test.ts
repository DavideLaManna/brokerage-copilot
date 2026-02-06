/**
 * Performance Attribution Types Tests
 */

import { describe, it, expect } from 'vitest';
import {
  getDTEBucket,
  getHoldDurationBucket,
  getTradeOutcome,
  calculateHoldDays,
  calculatePnLPercent,
  formatDTEBucket,
  formatHoldDurationBucket,
  formatCatalystCategory,
  formatTradeOutcome,
  createEmptyMetrics,
  calculateMetrics,
  validateClosedTrade,
  DTEBucketSchema,
  HoldDurationBucketSchema,
  CatalystCategorySchema,
  TradeOutcomeSchema,
  ClosedTradeSchema,
  type ClosedTrade,
  type DTEBucket,
  type HoldDurationBucket,
  type CatalystCategory,
  type TradeOutcome,
} from './performance.js';

describe('Performance Types', () => {
  // ===========================================================================
  // Schema Validation Tests
  // ===========================================================================

  describe('DTEBucketSchema', () => {
    it('should validate valid DTE buckets', () => {
      const validBuckets: DTEBucket[] = ['0-7', '7-14', '14-30', '30-60', '60-90', '90+'];
      for (const bucket of validBuckets) {
        expect(DTEBucketSchema.safeParse(bucket).success).toBe(true);
      }
    });

    it('should reject invalid DTE buckets', () => {
      expect(DTEBucketSchema.safeParse('invalid').success).toBe(false);
      expect(DTEBucketSchema.safeParse('100+').success).toBe(false);
      expect(DTEBucketSchema.safeParse(null).success).toBe(false);
    });
  });

  describe('HoldDurationBucketSchema', () => {
    it('should validate valid hold duration buckets', () => {
      const validBuckets: HoldDurationBucket[] = [
        'intraday', '1-3_days', '1_week', '2_weeks', '1_month', '1_month+',
      ];
      for (const bucket of validBuckets) {
        expect(HoldDurationBucketSchema.safeParse(bucket).success).toBe(true);
      }
    });

    it('should reject invalid hold duration buckets', () => {
      expect(HoldDurationBucketSchema.safeParse('invalid').success).toBe(false);
      expect(HoldDurationBucketSchema.safeParse('1_year').success).toBe(false);
    });
  });

  describe('CatalystCategorySchema', () => {
    it('should validate valid catalyst categories', () => {
      const validCatalysts: CatalystCategory[] = [
        'earnings', 'technical', 'news', 'sector_move', 'volatility_play', 'none', 'other',
      ];
      for (const catalyst of validCatalysts) {
        expect(CatalystCategorySchema.safeParse(catalyst).success).toBe(true);
      }
    });

    it('should reject invalid catalyst categories', () => {
      expect(CatalystCategorySchema.safeParse('invalid').success).toBe(false);
      expect(CatalystCategorySchema.safeParse('merger').success).toBe(false);
    });
  });

  describe('TradeOutcomeSchema', () => {
    it('should validate valid trade outcomes', () => {
      const validOutcomes: TradeOutcome[] = ['win', 'loss', 'breakeven'];
      for (const outcome of validOutcomes) {
        expect(TradeOutcomeSchema.safeParse(outcome).success).toBe(true);
      }
    });

    it('should reject invalid trade outcomes', () => {
      expect(TradeOutcomeSchema.safeParse('invalid').success).toBe(false);
      expect(TradeOutcomeSchema.safeParse('draw').success).toBe(false);
    });
  });

  describe('ClosedTradeSchema', () => {
    const validTrade: ClosedTrade = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      accountId: 'test-account',
      underlying: 'AAPL',
      strategyType: 'long_call',
      dteAtEntry: 30,
      dteBucket: '14-30',
      catalyst: 'earnings',
      contracts: 5,
      entryDate: new Date('2024-01-15'),
      entryPrice: 5.00,
      entryCost: 2500,
      exitDate: new Date('2024-01-20'),
      exitPrice: 7.50,
      exitProceeds: 3750,
      realizedPnL: 1250,
      realizedPnLPercent: 50,
      outcome: 'win',
      holdDays: 5,
      holdDurationBucket: '1-3_days',
      netPnL: 1200,
      createdAt: new Date(),
    };

    it('should validate a valid closed trade', () => {
      const result = ClosedTradeSchema.safeParse(validTrade);
      expect(result.success).toBe(true);
    });

    it('should validate a trade with optional fields', () => {
      const tradeWithOptionals: ClosedTrade = {
        ...validTrade,
        confidence: 'high',
        commission: 10,
        fees: 2.50,
        proposalId: '550e8400-e29b-41d4-a716-446655440001',
        entryOrderIds: ['order1', 'order2'],
        exitOrderIds: ['order3'],
        notes: 'Good trade based on earnings catalyst',
        tags: ['earnings', 'tech'],
      };
      const result = ClosedTradeSchema.safeParse(tradeWithOptionals);
      expect(result.success).toBe(true);
    });

    it('should reject trade with missing required fields', () => {
      const invalidTrade = { ...validTrade };
      delete (invalidTrade as Record<string, unknown>).underlying;
      const result = ClosedTradeSchema.safeParse(invalidTrade);
      expect(result.success).toBe(false);
    });

    it('should reject trade with invalid strategy type', () => {
      const invalidTrade = { ...validTrade, strategyType: 'invalid_strategy' };
      const result = ClosedTradeSchema.safeParse(invalidTrade);
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // Helper Function Tests
  // ===========================================================================

  describe('getDTEBucket', () => {
    it('should return correct bucket for DTE 0-7', () => {
      expect(getDTEBucket(0)).toBe('0-7');
      expect(getDTEBucket(5)).toBe('0-7');
      expect(getDTEBucket(7)).toBe('0-7');
    });

    it('should return correct bucket for DTE 7-14', () => {
      expect(getDTEBucket(8)).toBe('7-14');
      expect(getDTEBucket(10)).toBe('7-14');
      expect(getDTEBucket(14)).toBe('7-14');
    });

    it('should return correct bucket for DTE 14-30', () => {
      expect(getDTEBucket(15)).toBe('14-30');
      expect(getDTEBucket(20)).toBe('14-30');
      expect(getDTEBucket(30)).toBe('14-30');
    });

    it('should return correct bucket for DTE 30-60', () => {
      expect(getDTEBucket(31)).toBe('30-60');
      expect(getDTEBucket(45)).toBe('30-60');
      expect(getDTEBucket(60)).toBe('30-60');
    });

    it('should return correct bucket for DTE 60-90', () => {
      expect(getDTEBucket(61)).toBe('60-90');
      expect(getDTEBucket(75)).toBe('60-90');
      expect(getDTEBucket(90)).toBe('60-90');
    });

    it('should return correct bucket for DTE 90+', () => {
      expect(getDTEBucket(91)).toBe('90+');
      expect(getDTEBucket(120)).toBe('90+');
      expect(getDTEBucket(365)).toBe('90+');
    });
  });

  describe('getHoldDurationBucket', () => {
    it('should return intraday for 0 days', () => {
      expect(getHoldDurationBucket(0)).toBe('intraday');
      expect(getHoldDurationBucket(0.5)).toBe('intraday');
    });

    it('should return 1-3_days for 1-3 days', () => {
      expect(getHoldDurationBucket(1)).toBe('1-3_days');
      expect(getHoldDurationBucket(2)).toBe('1-3_days');
      expect(getHoldDurationBucket(3)).toBe('1-3_days');
    });

    it('should return 1_week for 4-7 days', () => {
      expect(getHoldDurationBucket(4)).toBe('1_week');
      expect(getHoldDurationBucket(5)).toBe('1_week');
      expect(getHoldDurationBucket(7)).toBe('1_week');
    });

    it('should return 2_weeks for 8-14 days', () => {
      expect(getHoldDurationBucket(8)).toBe('2_weeks');
      expect(getHoldDurationBucket(10)).toBe('2_weeks');
      expect(getHoldDurationBucket(14)).toBe('2_weeks');
    });

    it('should return 1_month for 15-30 days', () => {
      expect(getHoldDurationBucket(15)).toBe('1_month');
      expect(getHoldDurationBucket(20)).toBe('1_month');
      expect(getHoldDurationBucket(30)).toBe('1_month');
    });

    it('should return 1_month+ for > 30 days', () => {
      expect(getHoldDurationBucket(31)).toBe('1_month+');
      expect(getHoldDurationBucket(60)).toBe('1_month+');
      expect(getHoldDurationBucket(90)).toBe('1_month+');
    });
  });

  describe('getTradeOutcome', () => {
    it('should return win for positive P&L', () => {
      expect(getTradeOutcome(100)).toBe('win');
      expect(getTradeOutcome(1.01)).toBe('win');
      expect(getTradeOutcome(5000)).toBe('win');
    });

    it('should return loss for negative P&L', () => {
      expect(getTradeOutcome(-100)).toBe('loss');
      expect(getTradeOutcome(-1.01)).toBe('loss');
      expect(getTradeOutcome(-5000)).toBe('loss');
    });

    it('should return breakeven for P&L within threshold', () => {
      expect(getTradeOutcome(0)).toBe('breakeven');
      expect(getTradeOutcome(0.5)).toBe('breakeven');
      expect(getTradeOutcome(-0.5)).toBe('breakeven');
      expect(getTradeOutcome(1)).toBe('breakeven');
      expect(getTradeOutcome(-1)).toBe('breakeven');
    });

    it('should respect custom threshold', () => {
      expect(getTradeOutcome(5, 10)).toBe('breakeven');
      expect(getTradeOutcome(-5, 10)).toBe('breakeven');
      expect(getTradeOutcome(11, 10)).toBe('win');
      expect(getTradeOutcome(-11, 10)).toBe('loss');
    });
  });

  describe('calculateHoldDays', () => {
    it('should calculate correct hold days', () => {
      const entry = new Date('2024-01-15');
      const exit = new Date('2024-01-20');
      expect(calculateHoldDays(entry, exit)).toBe(5);
    });

    it('should return 0 for same day', () => {
      const date = new Date('2024-01-15');
      expect(calculateHoldDays(date, date)).toBe(0);
    });

    it('should handle longer periods', () => {
      const entry = new Date('2024-01-01');
      const exit = new Date('2024-02-01');
      expect(calculateHoldDays(entry, exit)).toBe(31);
    });

    it('should return 0 for negative duration', () => {
      const entry = new Date('2024-01-20');
      const exit = new Date('2024-01-15');
      expect(calculateHoldDays(entry, exit)).toBe(0);
    });
  });

  describe('calculatePnLPercent', () => {
    it('should calculate correct percentage for positive entry cost', () => {
      expect(calculatePnLPercent(100, 1000)).toBe(10);
      expect(calculatePnLPercent(500, 1000)).toBe(50);
      expect(calculatePnLPercent(-200, 1000)).toBe(-20);
    });

    it('should handle credit trades (negative entry cost)', () => {
      // Credit of $500, profit of $250 = 50% return
      expect(calculatePnLPercent(250, -500)).toBe(50);
      // Credit of $500, loss of $250 = -50% return
      expect(calculatePnLPercent(-250, -500)).toBe(-50);
    });

    it('should return 0 for zero entry cost', () => {
      expect(calculatePnLPercent(100, 0)).toBe(0);
    });
  });

  describe('formatDTEBucket', () => {
    it('should format DTE buckets correctly', () => {
      expect(formatDTEBucket('0-7')).toBe('0-7 DTE');
      expect(formatDTEBucket('7-14')).toBe('7-14 DTE');
      expect(formatDTEBucket('14-30')).toBe('14-30 DTE');
      expect(formatDTEBucket('30-60')).toBe('30-60 DTE');
      expect(formatDTEBucket('60-90')).toBe('60-90 DTE');
      expect(formatDTEBucket('90+')).toBe('90+ DTE');
    });
  });

  describe('formatHoldDurationBucket', () => {
    it('should format hold duration buckets correctly', () => {
      expect(formatHoldDurationBucket('intraday')).toBe('Same Day');
      expect(formatHoldDurationBucket('1-3_days')).toBe('1-3 Days');
      expect(formatHoldDurationBucket('1_week')).toBe('1 Week');
      expect(formatHoldDurationBucket('2_weeks')).toBe('2 Weeks');
      expect(formatHoldDurationBucket('1_month')).toBe('1 Month');
      expect(formatHoldDurationBucket('1_month+')).toBe('> 1 Month');
    });
  });

  describe('formatCatalystCategory', () => {
    it('should format catalyst categories correctly', () => {
      expect(formatCatalystCategory('earnings')).toBe('Earnings');
      expect(formatCatalystCategory('technical')).toBe('Technical Setup');
      expect(formatCatalystCategory('news')).toBe('News/Event');
      expect(formatCatalystCategory('sector_move')).toBe('Sector Move');
      expect(formatCatalystCategory('volatility_play')).toBe('Volatility Play');
      expect(formatCatalystCategory('none')).toBe('No Catalyst');
      expect(formatCatalystCategory('other')).toBe('Other');
    });
  });

  describe('formatTradeOutcome', () => {
    it('should format trade outcomes correctly', () => {
      expect(formatTradeOutcome('win')).toBe('Win');
      expect(formatTradeOutcome('loss')).toBe('Loss');
      expect(formatTradeOutcome('breakeven')).toBe('Breakeven');
    });
  });

  // ===========================================================================
  // Metrics Calculation Tests
  // ===========================================================================

  describe('createEmptyMetrics', () => {
    it('should create metrics with all zeros', () => {
      const metrics = createEmptyMetrics();
      expect(metrics.totalTrades).toBe(0);
      expect(metrics.wins).toBe(0);
      expect(metrics.losses).toBe(0);
      expect(metrics.breakevens).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.totalPnL).toBe(0);
      expect(metrics.avgPnL).toBe(0);
      expect(metrics.profitFactor).toBe(0);
      expect(metrics.expectancy).toBe(0);
    });
  });

  describe('calculateMetrics', () => {
    const createTrade = (pnl: number, holdDays: number): ClosedTrade => ({
      id: `${Math.random()}`,
      accountId: 'test',
      underlying: 'AAPL',
      strategyType: 'long_call',
      dteAtEntry: 30,
      dteBucket: '14-30',
      catalyst: 'earnings',
      contracts: 1,
      entryDate: new Date(),
      entryPrice: 5,
      entryCost: 500,
      exitDate: new Date(),
      exitPrice: pnl > 0 ? 5 + pnl / 100 : 5 + pnl / 100,
      exitProceeds: 500 + pnl,
      realizedPnL: pnl,
      realizedPnLPercent: (pnl / 500) * 100,
      outcome: pnl > 1 ? 'win' : pnl < -1 ? 'loss' : 'breakeven',
      holdDays,
      holdDurationBucket: getHoldDurationBucket(holdDays),
      netPnL: pnl,
      createdAt: new Date(),
    });

    it('should calculate correct metrics for winning trades', () => {
      const trades = [
        createTrade(100, 5),
        createTrade(200, 3),
        createTrade(50, 7),
      ];

      const metrics = calculateMetrics(trades);

      expect(metrics.totalTrades).toBe(3);
      expect(metrics.wins).toBe(3);
      expect(metrics.losses).toBe(0);
      expect(metrics.winRate).toBe(100);
      expect(metrics.totalPnL).toBe(350);
      expect(metrics.avgPnL).toBeCloseTo(116.67, 1);
      expect(metrics.maxWin).toBe(200);
    });

    it('should calculate correct metrics for losing trades', () => {
      const trades = [
        createTrade(-100, 5),
        createTrade(-200, 3),
        createTrade(-50, 7),
      ];

      const metrics = calculateMetrics(trades);

      expect(metrics.totalTrades).toBe(3);
      expect(metrics.wins).toBe(0);
      expect(metrics.losses).toBe(3);
      expect(metrics.winRate).toBe(0);
      expect(metrics.totalPnL).toBe(-350);
      expect(metrics.maxLoss).toBe(-200);
    });

    it('should calculate correct metrics for mixed trades', () => {
      const trades = [
        createTrade(100, 5),   // win
        createTrade(-50, 3),   // loss
        createTrade(200, 7),   // win
        createTrade(-100, 2),  // loss
        createTrade(0, 1),     // breakeven
      ];

      const metrics = calculateMetrics(trades);

      expect(metrics.totalTrades).toBe(5);
      expect(metrics.wins).toBe(2);
      expect(metrics.losses).toBe(2);
      expect(metrics.breakevens).toBe(1);
      expect(metrics.winRate).toBe(40);
      expect(metrics.totalPnL).toBe(150);
      expect(metrics.avgWin).toBe(150); // (100 + 200) / 2
      expect(metrics.avgLoss).toBe(-75); // (-50 + -100) / 2
      expect(metrics.maxWin).toBe(200);
      expect(metrics.maxLoss).toBe(-100);
    });

    it('should calculate profit factor correctly', () => {
      const trades = [
        createTrade(300, 5),   // win
        createTrade(-100, 3),  // loss
      ];

      const metrics = calculateMetrics(trades);

      // Profit factor = gross wins / |gross losses| = 300 / 100 = 3
      expect(metrics.profitFactor).toBe(3);
    });

    it('should handle empty trades array', () => {
      const metrics = calculateMetrics([]);

      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.totalPnL).toBe(0);
    });

    it('should calculate average hold days', () => {
      const trades = [
        createTrade(100, 5),
        createTrade(100, 10),
        createTrade(100, 15),
      ];

      const metrics = calculateMetrics(trades);

      expect(metrics.avgHoldDays).toBe(10);
    });

    it('should calculate expectancy correctly', () => {
      const trades = [
        createTrade(100, 5),   // win
        createTrade(-50, 3),   // loss
      ];

      const metrics = calculateMetrics(trades);

      // Win rate = 50%, avg win = 100, avg loss = -50
      // Expectancy = (0.5 * 100) + (0.5 * -50) = 50 - 25 = 25
      expect(metrics.expectancy).toBe(25);
    });
  });

  // ===========================================================================
  // Validation Tests
  // ===========================================================================

  describe('validateClosedTrade', () => {
    it('should validate a valid trade', () => {
      const trade = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        accountId: 'test',
        underlying: 'AAPL',
        strategyType: 'long_call',
        dteAtEntry: 30,
        dteBucket: '14-30',
        catalyst: 'earnings',
        contracts: 1,
        entryDate: new Date(),
        entryPrice: 5,
        entryCost: 500,
        exitDate: new Date(),
        exitPrice: 6,
        exitProceeds: 600,
        realizedPnL: 100,
        realizedPnLPercent: 20,
        outcome: 'win',
        holdDays: 5,
        holdDurationBucket: '1-3_days',
        netPnL: 100,
        createdAt: new Date(),
      };

      const result = validateClosedTrade(trade);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid trade with detailed errors', () => {
      const invalidTrade = {
        id: 'not-a-uuid',
        accountId: '',
        underlying: '',
        strategyType: 'invalid',
      };

      const result = validateClosedTrade(invalidTrade);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
