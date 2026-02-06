/**
 * Performance Attribution Service
 *
 * Tracks and analyzes trade performance to help users understand
 * which types of trades perform best. Provides breakdown by strategy type,
 * underlying, DTE bucket, catalyst category, and hold duration.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  type ClosedTrade,
  type StoredClosedTrade,
  type PerformanceMetrics,
  type PerformanceBreakdown,
  type PerformanceAttribution,
  type PerformancePattern,
  type DrawdownInfo,
  type EquityCurvePoint,
  type ClosedTradeQueryOptions,
  type ClosedTradeQueryResult,
  type PerformanceAttributionOptions,
  type DTEBucket,
  type HoldDurationBucket,
  type CatalystCategory,
  type TradeOutcome,
  ClosedTradeSchema,
  PERFORMANCE_SCHEMA_VERSION,
  getDTEBucket,
  getHoldDurationBucket,
  getTradeOutcome,
  calculateHoldDays,
  calculatePnLPercent,
  calculateMetrics,
  createEmptyMetrics,
} from '../types/performance.js';
import type { StrategyType, ConfidenceLevel } from '../types/trade-proposal.js';
import { encrypt, decrypt, type EncryptedData } from '../storage/encryption.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration options for PerformanceAttributionService
 */
export interface PerformanceAttributionServiceOptions {
  /** Directory to store performance data */
  dataDir?: string;
  /** Master password for encryption */
  masterPassword: string;
  /** Minimum sample size for pattern detection */
  minPatternSampleSize?: number;
  /** P&L threshold for breakeven classification */
  breakevenThreshold?: number;
}

/**
 * Logger interface for the service
 */
export interface PerformanceAttributionLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Stored data file format
 */
interface PerformanceDataFile {
  version: number;
  trades: Record<string, EncryptedData>; // key = trade id
  metadata: {
    createdAt: string;
    updatedAt: string;
    tradeCount: number;
  };
}

const DEFAULT_DATA_DIR = '.config/performance';
const DEFAULT_MIN_PATTERN_SAMPLE_SIZE = 5;
const DEFAULT_BREAKEVEN_THRESHOLD = 1; // $1

/**
 * Default console logger
 */
const defaultLogger: PerformanceAttributionLogger = {
  info: (message, data) =>
    console.log(`[PERFORMANCE] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message, data) =>
    console.warn(`[PERFORMANCE] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message, data) =>
    console.error(`[PERFORMANCE] ${message}`, data ? JSON.stringify(data) : ''),
};

// ============================================================================
// PerformanceAttributionService
// ============================================================================

/**
 * Service for tracking and analyzing trade performance
 */
export class PerformanceAttributionService {
  private trades: Map<string, StoredClosedTrade[]> = new Map(); // key = accountId
  private dataDir: string;
  private masterPassword: string;
  private minPatternSampleSize: number;
  private breakevenThreshold: number;
  private initialized: boolean = false;
  private logger: PerformanceAttributionLogger;

  constructor(
    options: PerformanceAttributionServiceOptions,
    logger?: PerformanceAttributionLogger
  ) {
    if (!options.masterPassword || options.masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
    this.masterPassword = options.masterPassword;
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.minPatternSampleSize = options.minPatternSampleSize || DEFAULT_MIN_PATTERN_SAMPLE_SIZE;
    this.breakevenThreshold = options.breakevenThreshold || DEFAULT_BREAKEVEN_THRESHOLD;
    this.logger = logger || defaultLogger;
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    }

    // Load existing data
    await this.loadAllTrades();

    this.initialized = true;
    this.logger.info('PerformanceAttributionService initialized', {
      tradesLoaded: this.getTotalTradeCount(),
    });
  }

  // ===========================================================================
  // Trade Recording
  // ===========================================================================

  /**
   * Record a closed trade
   */
  async recordTrade(params: {
    accountId: string;
    underlying: string;
    strategyType: StrategyType;
    dteAtEntry: number;
    catalyst: CatalystCategory;
    contracts: number;
    entryDate: Date;
    entryPrice: number;
    entryCost: number;
    exitDate: Date;
    exitPrice: number;
    exitProceeds: number;
    commission?: number;
    fees?: number;
    confidence?: ConfidenceLevel;
    proposalId?: string;
    entryOrderIds?: string[];
    exitOrderIds?: string[];
    notes?: string;
    tags?: string[];
  }): Promise<StoredClosedTrade> {
    const id = randomUUID();
    const now = new Date();

    // Calculate derived values
    const realizedPnL = params.exitProceeds - params.entryCost;
    const realizedPnLPercent = calculatePnLPercent(realizedPnL, params.entryCost);
    const holdDays = calculateHoldDays(params.entryDate, params.exitDate);
    const commission = params.commission ?? 0;
    const fees = params.fees ?? 0;
    const netPnL = realizedPnL - commission - fees;
    const outcome = getTradeOutcome(realizedPnL, this.breakevenThreshold);
    const dteBucket = getDTEBucket(params.dteAtEntry);
    const holdDurationBucket = getHoldDurationBucket(holdDays);

    const trade: ClosedTrade = {
      id,
      accountId: params.accountId,
      underlying: params.underlying.toUpperCase(),
      strategyType: params.strategyType,
      dteAtEntry: params.dteAtEntry,
      dteBucket,
      confidence: params.confidence,
      catalyst: params.catalyst,
      contracts: params.contracts,
      entryDate: params.entryDate,
      entryPrice: params.entryPrice,
      entryCost: params.entryCost,
      exitDate: params.exitDate,
      exitPrice: params.exitPrice,
      exitProceeds: params.exitProceeds,
      realizedPnL,
      realizedPnLPercent,
      outcome,
      holdDays,
      holdDurationBucket,
      commission: params.commission,
      fees: params.fees,
      netPnL,
      proposalId: params.proposalId,
      entryOrderIds: params.entryOrderIds,
      exitOrderIds: params.exitOrderIds,
      createdAt: now,
      notes: params.notes,
      tags: params.tags,
    };

    // Validate
    const validation = ClosedTradeSchema.safeParse(trade);
    if (!validation.success) {
      const errorMessage = `Invalid closed trade: ${validation.error.errors.map(e => e.message).join(', ')}`;
      this.logger.error(errorMessage, { trade });
      throw new Error(errorMessage);
    }

    const storedTrade: StoredClosedTrade = {
      ...trade,
      version: PERFORMANCE_SCHEMA_VERSION,
    };

    // Add to memory
    const accountTrades = this.trades.get(params.accountId) ?? [];
    accountTrades.push(storedTrade);
    this.trades.set(params.accountId, accountTrades);

    // Persist
    await this.saveAccountTrades(params.accountId);

    this.logger.info('Trade recorded', {
      id,
      accountId: params.accountId,
      underlying: params.underlying,
      strategyType: params.strategyType,
      outcome,
      realizedPnL,
    });

    return storedTrade;
  }

  /**
   * Update a closed trade
   */
  async updateTrade(
    accountId: string,
    tradeId: string,
    updates: Partial<Pick<ClosedTrade, 'notes' | 'tags' | 'catalyst' | 'confidence'>>
  ): Promise<StoredClosedTrade | null> {
    const accountTrades = this.trades.get(accountId);
    if (!accountTrades) {
      return null;
    }

    const tradeIndex = accountTrades.findIndex(t => t.id === tradeId);
    if (tradeIndex === -1) {
      return null;
    }

    const updatedTrade: StoredClosedTrade = {
      ...accountTrades[tradeIndex]!,
      ...updates,
    };

    accountTrades[tradeIndex] = updatedTrade;
    this.trades.set(accountId, accountTrades);

    await this.saveAccountTrades(accountId);

    this.logger.info('Trade updated', { tradeId, accountId, updates: Object.keys(updates) });

    return updatedTrade;
  }

  /**
   * Delete a closed trade
   */
  async deleteTrade(accountId: string, tradeId: string): Promise<boolean> {
    const accountTrades = this.trades.get(accountId);
    if (!accountTrades) {
      return false;
    }

    const originalLength = accountTrades.length;
    const filteredTrades = accountTrades.filter(t => t.id !== tradeId);

    if (filteredTrades.length === originalLength) {
      return false;
    }

    this.trades.set(accountId, filteredTrades);
    await this.saveAccountTrades(accountId);

    this.logger.info('Trade deleted', { tradeId, accountId });

    return true;
  }

  /**
   * Get a trade by ID
   */
  getTrade(accountId: string, tradeId: string): StoredClosedTrade | null {
    const accountTrades = this.trades.get(accountId);
    if (!accountTrades) {
      return null;
    }
    return accountTrades.find(t => t.id === tradeId) ?? null;
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Query closed trades with filters
   */
  query(accountId: string, options?: ClosedTradeQueryOptions): ClosedTradeQueryResult {
    let trades = [...(this.trades.get(accountId) ?? [])];

    // Apply filters
    if (options?.underlyings && options.underlyings.length > 0) {
      const underlyings = options.underlyings.map(u => u.toUpperCase());
      trades = trades.filter(t => underlyings.includes(t.underlying));
    }

    if (options?.strategyTypes && options.strategyTypes.length > 0) {
      trades = trades.filter(t => options.strategyTypes!.includes(t.strategyType));
    }

    if (options?.catalysts && options.catalysts.length > 0) {
      trades = trades.filter(t => options.catalysts!.includes(t.catalyst));
    }

    if (options?.dteBuckets && options.dteBuckets.length > 0) {
      trades = trades.filter(t => options.dteBuckets!.includes(t.dteBucket));
    }

    if (options?.holdDurationBuckets && options.holdDurationBuckets.length > 0) {
      trades = trades.filter(t => options.holdDurationBuckets!.includes(t.holdDurationBucket));
    }

    if (options?.outcomes && options.outcomes.length > 0) {
      trades = trades.filter(t => options.outcomes!.includes(t.outcome));
    }

    if (options?.tags && options.tags.length > 0) {
      trades = trades.filter(t =>
        t.tags && options.tags!.some(tag => t.tags!.includes(tag))
      );
    }

    if (options?.startDate) {
      const startTime = options.startDate.getTime();
      trades = trades.filter(t => t.exitDate.getTime() >= startTime);
    }

    if (options?.endDate) {
      const endTime = options.endDate.getTime();
      trades = trades.filter(t => t.exitDate.getTime() <= endTime);
    }

    if (options?.minPnL !== undefined) {
      trades = trades.filter(t => t.realizedPnL >= options.minPnL!);
    }

    if (options?.maxPnL !== undefined) {
      trades = trades.filter(t => t.realizedPnL <= options.maxPnL!);
    }

    const totalCount = trades.length;

    // Sort
    const sortBy = options?.sortBy ?? 'exitDate';
    const sortOrder = options?.sortOrder ?? 'desc';

    trades.sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortBy) {
        case 'exitDate':
          aVal = a.exitDate.getTime();
          bVal = b.exitDate.getTime();
          break;
        case 'entryDate':
          aVal = a.entryDate.getTime();
          bVal = b.entryDate.getTime();
          break;
        case 'realizedPnL':
          aVal = a.realizedPnL;
          bVal = b.realizedPnL;
          break;
        case 'realizedPnLPercent':
          aVal = a.realizedPnLPercent;
          bVal = b.realizedPnLPercent;
          break;
        case 'holdDays':
          aVal = a.holdDays;
          bVal = b.holdDays;
          break;
        default:
          aVal = a.exitDate.getTime();
          bVal = b.exitDate.getTime();
      }

      const diff = bVal - aVal;
      return sortOrder === 'desc' ? diff : -diff;
    });

    // Pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? trades.length;
    trades = trades.slice(offset, offset + limit);

    return {
      trades,
      totalCount,
      hasMore: offset + trades.length < totalCount,
    };
  }

  /**
   * Get trades for a specific date range
   */
  getTradesByDateRange(
    accountId: string,
    startDate: Date,
    endDate: Date,
    options?: Omit<ClosedTradeQueryOptions, 'startDate' | 'endDate'>
  ): ClosedTradeQueryResult {
    return this.query(accountId, { ...options, startDate, endDate });
  }

  /**
   * Get trades for a specific underlying
   */
  getTradesByUnderlying(
    accountId: string,
    underlying: string,
    options?: Omit<ClosedTradeQueryOptions, 'underlyings'>
  ): ClosedTradeQueryResult {
    return this.query(accountId, { ...options, underlyings: [underlying] });
  }

  /**
   * Get trades for a specific strategy
   */
  getTradesByStrategy(
    accountId: string,
    strategyType: StrategyType,
    options?: Omit<ClosedTradeQueryOptions, 'strategyTypes'>
  ): ClosedTradeQueryResult {
    return this.query(accountId, { ...options, strategyTypes: [strategyType] });
  }

  // ===========================================================================
  // Performance Attribution
  // ===========================================================================

  /**
   * Generate performance attribution report
   */
  getPerformanceAttribution(
    accountId: string,
    options?: PerformanceAttributionOptions
  ): PerformanceAttribution {
    const allTrades = this.query(accountId, {
      startDate: options?.startDate,
      endDate: options?.endDate,
      underlyings: options?.underlyings,
      strategyTypes: options?.strategyTypes,
    }).trades;

    const now = new Date();
    const topTradesCount = options?.topTradesCount ?? 5;
    const minSampleSize = options?.minSampleSize ?? this.minPatternSampleSize;

    // Calculate overall metrics
    const overall = calculateMetrics(allTrades);

    // Calculate breakdowns
    const byStrategy = this.calculateBreakdown<StrategyType>(
      allTrades,
      'Strategy Type',
      t => t.strategyType
    );

    const byUnderlying = this.calculateBreakdown<string>(
      allTrades,
      'Underlying',
      t => t.underlying
    );

    const byDTEBucket = this.calculateBreakdown<DTEBucket>(
      allTrades,
      'DTE Bucket',
      t => t.dteBucket
    );

    const byCatalyst = this.calculateBreakdown<CatalystCategory>(
      allTrades,
      'Catalyst',
      t => t.catalyst
    );

    const byHoldDuration = this.calculateBreakdown<HoldDurationBucket>(
      allTrades,
      'Hold Duration',
      t => t.holdDurationBucket
    );

    // Get top and worst trades
    const sortedByPnL = [...allTrades].sort((a, b) => b.realizedPnL - a.realizedPnL);
    const topTrades = sortedByPnL.slice(0, topTradesCount);
    const worstTrades = sortedByPnL.slice(-topTradesCount).reverse();

    // Detect patterns
    const patterns = this.detectPatterns(
      overall,
      byStrategy,
      byUnderlying,
      byDTEBucket,
      byCatalyst,
      byHoldDuration,
      minSampleSize
    );

    return {
      accountId,
      startDate: options?.startDate ?? new Date(0),
      endDate: options?.endDate ?? now,
      overall,
      byStrategy,
      byUnderlying,
      byDTEBucket,
      byCatalyst,
      byHoldDuration,
      topTrades,
      worstTrades,
      patterns,
      generatedAt: now,
    };
  }

  /**
   * Get performance metrics for an account
   */
  getMetrics(accountId: string, options?: ClosedTradeQueryOptions): PerformanceMetrics {
    const trades = this.query(accountId, options).trades;
    return calculateMetrics(trades);
  }

  /**
   * Get drawdown information
   */
  getDrawdownInfo(accountId: string, startingValue: number = 100000): DrawdownInfo {
    const trades = this.query(accountId, { sortBy: 'exitDate', sortOrder: 'asc' }).trades;

    if (trades.length === 0) {
      return {
        currentDrawdown: 0,
        currentDrawdownDollars: 0,
        maxDrawdown: 0,
        maxDrawdownDollars: 0,
        peakValue: startingValue,
        peakDate: new Date(),
        currentValue: startingValue,
        daysSincePeak: 0,
      };
    }

    let peakValue = startingValue;
    let peakDate = trades[0]!.exitDate;
    let maxDrawdown = 0;
    let maxDrawdownDollars = 0;
    let currentValue = startingValue;

    for (const trade of trades) {
      currentValue += trade.netPnL;

      if (currentValue > peakValue) {
        peakValue = currentValue;
        peakDate = trade.exitDate;
      }

      const drawdown = ((currentValue - peakValue) / peakValue) * 100;
      const drawdownDollars = currentValue - peakValue;

      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownDollars = drawdownDollars;
      }
    }

    const currentDrawdown = ((currentValue - peakValue) / peakValue) * 100;
    const currentDrawdownDollars = currentValue - peakValue;
    const daysSincePeak = calculateHoldDays(peakDate, new Date());

    return {
      currentDrawdown,
      currentDrawdownDollars,
      maxDrawdown,
      maxDrawdownDollars,
      peakValue,
      peakDate,
      currentValue,
      daysSincePeak,
    };
  }

  /**
   * Get equity curve data points
   */
  getEquityCurve(accountId: string, startingValue: number = 100000): EquityCurvePoint[] {
    const trades = this.query(accountId, { sortBy: 'exitDate', sortOrder: 'asc' }).trades;

    if (trades.length === 0) {
      return [];
    }

    const points: EquityCurvePoint[] = [];
    let cumulativePnL = 0;
    let value = startingValue;
    let peakValue = startingValue;

    // Add starting point
    points.push({
      date: trades[0]!.entryDate,
      cumulativePnL: 0,
      value: startingValue,
      tradeCount: 0,
      drawdown: 0,
    });

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i]!;
      cumulativePnL += trade.netPnL;
      value = startingValue + cumulativePnL;

      if (value > peakValue) {
        peakValue = value;
      }

      const drawdown = ((value - peakValue) / peakValue) * 100;

      points.push({
        date: trade.exitDate,
        cumulativePnL,
        value,
        tradeCount: i + 1,
        drawdown,
      });
    }

    return points;
  }

  /**
   * Get statistics summary
   */
  getStatistics(accountId: string): {
    totalTrades: number;
    byOutcome: Record<TradeOutcome, number>;
    byStrategy: Record<string, number>;
    byUnderlying: Record<string, number>;
    dateRange: { earliest: Date | null; latest: Date | null };
  } {
    const trades = this.trades.get(accountId) ?? [];

    const byOutcome: Record<TradeOutcome, number> = {
      win: 0,
      loss: 0,
      breakeven: 0,
    };

    const byStrategy: Record<string, number> = {};
    const byUnderlying: Record<string, number> = {};
    let earliest: Date | null = null;
    let latest: Date | null = null;

    for (const trade of trades) {
      byOutcome[trade.outcome]++;
      byStrategy[trade.strategyType] = (byStrategy[trade.strategyType] ?? 0) + 1;
      byUnderlying[trade.underlying] = (byUnderlying[trade.underlying] ?? 0) + 1;

      if (!earliest || trade.exitDate < earliest) {
        earliest = trade.exitDate;
      }
      if (!latest || trade.exitDate > latest) {
        latest = trade.exitDate;
      }
    }

    return {
      totalTrades: trades.length,
      byOutcome,
      byStrategy,
      byUnderlying,
      dateRange: { earliest, latest },
    };
  }

  /**
   * Get trade count for an account
   */
  getTradeCount(accountId: string): number {
    return (this.trades.get(accountId) ?? []).length;
  }

  /**
   * Get total trade count across all accounts
   */
  getTotalTradeCount(): number {
    let total = 0;
    for (const trades of this.trades.values()) {
      total += trades.length;
    }
    return total;
  }

  // ===========================================================================
  // Private Methods - Breakdown Calculation
  // ===========================================================================

  private calculateBreakdown<T extends string>(
    trades: StoredClosedTrade[],
    dimension: string,
    getValue: (trade: StoredClosedTrade) => T
  ): PerformanceBreakdown<T> {
    const byValue: Record<string, StoredClosedTrade[]> = {};

    for (const trade of trades) {
      const value = getValue(trade);
      if (!byValue[value]) {
        byValue[value] = [];
      }
      byValue[value]!.push(trade);
    }

    const metricsMap: Record<string, PerformanceMetrics> = {};
    let bestPerforming: T | null = null;
    let worstPerforming: T | null = null;
    let bestWinRate = -1;
    let worstWinRate = 101;

    for (const [value, groupTrades] of Object.entries(byValue)) {
      const metrics = calculateMetrics(groupTrades);
      metricsMap[value] = metrics;

      if (metrics.totalTrades >= this.minPatternSampleSize) {
        if (metrics.winRate > bestWinRate) {
          bestWinRate = metrics.winRate;
          bestPerforming = value as T;
        }
        if (metrics.winRate < worstWinRate) {
          worstWinRate = metrics.winRate;
          worstPerforming = value as T;
        }
      }
    }

    return {
      dimension,
      byValue: metricsMap as Record<T, PerformanceMetrics>,
      bestPerforming,
      worstPerforming,
    };
  }

  // ===========================================================================
  // Private Methods - Pattern Detection
  // ===========================================================================

  private detectPatterns(
    overall: PerformanceMetrics,
    byStrategy: PerformanceBreakdown<StrategyType>,
    byUnderlying: PerformanceBreakdown<string>,
    byDTEBucket: PerformanceBreakdown<DTEBucket>,
    byCatalyst: PerformanceBreakdown<CatalystCategory>,
    byHoldDuration: PerformanceBreakdown<HoldDurationBucket>,
    minSampleSize: number
  ): PerformancePattern[] {
    const patterns: PerformancePattern[] = [];

    // Helper to add pattern if significant
    const addPatternIfSignificant = (
      id: string,
      type: PerformancePattern['type'],
      description: string,
      metrics: PerformanceMetrics,
      baselineValue: number,
      actualValue: number,
      recommendation?: string
    ) => {
      if (metrics.totalTrades < minSampleSize) {
        return;
      }

      const difference = actualValue - baselineValue;
      const differencePercent = baselineValue !== 0
        ? (difference / Math.abs(baselineValue)) * 100
        : 0;

      // Only add if difference is meaningful (>10% or >5pp for win rates)
      if (Math.abs(differencePercent) < 10 && Math.abs(difference) < 5) {
        return;
      }

      const significance: PerformancePattern['significance'] =
        metrics.totalTrades >= 20 ? 'high' :
        metrics.totalTrades >= 10 ? 'medium' : 'low';

      patterns.push({
        id,
        type,
        description,
        metrics: {
          sampleSize: metrics.totalTrades,
          value: actualValue,
          baseline: baselineValue,
          difference,
          differencePercent,
        },
        significance,
        recommendation,
      });
    };

    // Analyze strategy performance
    for (const [strategy, metrics] of Object.entries(byStrategy.byValue)) {
      if (metrics.winRate > overall.winRate + 10) {
        addPatternIfSignificant(
          `strategy-outperform-${strategy}`,
          'outperformance',
          `${strategy.replace('_', ' ')} trades outperform: ${metrics.winRate.toFixed(1)}% win rate vs ${overall.winRate.toFixed(1)}% overall`,
          metrics,
          overall.winRate,
          metrics.winRate,
          `Consider increasing allocation to ${strategy.replace('_', ' ')} strategy`
        );
      } else if (metrics.winRate < overall.winRate - 10) {
        addPatternIfSignificant(
          `strategy-underperform-${strategy}`,
          'underperformance',
          `${strategy.replace('_', ' ')} trades underperform: ${metrics.winRate.toFixed(1)}% win rate vs ${overall.winRate.toFixed(1)}% overall`,
          metrics,
          overall.winRate,
          metrics.winRate,
          `Review ${strategy.replace('_', ' ')} strategy or reduce allocation`
        );
      }
    }

    // Analyze DTE bucket performance
    for (const [bucket, metrics] of Object.entries(byDTEBucket.byValue)) {
      if (metrics.winRate > overall.winRate + 10) {
        addPatternIfSignificant(
          `dte-outperform-${bucket}`,
          'outperformance',
          `${bucket} DTE trades outperform: ${metrics.winRate.toFixed(1)}% win rate vs ${overall.winRate.toFixed(1)}% overall`,
          metrics,
          overall.winRate,
          metrics.winRate,
          `Consider focusing on ${bucket} DTE options`
        );
      }
    }

    // Analyze hold duration performance
    for (const [bucket, metrics] of Object.entries(byHoldDuration.byValue)) {
      if (metrics.winRate > overall.winRate + 10) {
        addPatternIfSignificant(
          `hold-outperform-${bucket}`,
          'outperformance',
          `Trades held ${bucket.replace('_', ' ')} outperform: ${metrics.winRate.toFixed(1)}% win rate`,
          metrics,
          overall.winRate,
          metrics.winRate,
          `Consider targeting ${bucket.replace('_', ' ')} hold periods`
        );
      } else if (metrics.avgPnL > overall.avgPnL * 1.5 && metrics.totalTrades >= minSampleSize) {
        addPatternIfSignificant(
          `hold-avgpnl-${bucket}`,
          'outperformance',
          `Trades held ${bucket.replace('_', ' ')} have higher avg P&L: $${metrics.avgPnL.toFixed(2)} vs $${overall.avgPnL.toFixed(2)} overall`,
          metrics,
          overall.avgPnL,
          metrics.avgPnL,
          `Longer hold periods may improve returns`
        );
      }
    }

    // Analyze catalyst performance
    for (const [catalyst, metrics] of Object.entries(byCatalyst.byValue)) {
      if (metrics.winRate > overall.winRate + 15) {
        addPatternIfSignificant(
          `catalyst-outperform-${catalyst}`,
          'outperformance',
          `${catalyst.replace('_', ' ')} catalyst trades excel: ${metrics.winRate.toFixed(1)}% win rate`,
          metrics,
          overall.winRate,
          metrics.winRate,
          `Focus on ${catalyst.replace('_', ' ')} opportunities`
        );
      } else if (metrics.winRate < overall.winRate - 15) {
        addPatternIfSignificant(
          `catalyst-underperform-${catalyst}`,
          'underperformance',
          `${catalyst.replace('_', ' ')} catalyst trades underperform: ${metrics.winRate.toFixed(1)}% win rate`,
          metrics,
          overall.winRate,
          metrics.winRate,
          `Be more selective with ${catalyst.replace('_', ' ')} trades`
        );
      }
    }

    // Analyze top underlyings
    const underlyingEntries = Object.entries(byUnderlying.byValue)
      .filter(([_, m]) => m.totalTrades >= minSampleSize)
      .sort((a, b) => b[1].winRate - a[1].winRate);

    if (underlyingEntries.length >= 3) {
      const topUnderlying = underlyingEntries[0]!;
      const bottomUnderlying = underlyingEntries[underlyingEntries.length - 1]!;

      if (topUnderlying[1].winRate > overall.winRate + 10) {
        addPatternIfSignificant(
          `underlying-top-${topUnderlying[0]}`,
          'outperformance',
          `${topUnderlying[0]} is your best performing underlying: ${topUnderlying[1].winRate.toFixed(1)}% win rate`,
          topUnderlying[1],
          overall.winRate,
          topUnderlying[1].winRate,
          `Consider increasing ${topUnderlying[0]} exposure`
        );
      }

      if (bottomUnderlying[1].winRate < overall.winRate - 10) {
        addPatternIfSignificant(
          `underlying-bottom-${bottomUnderlying[0]}`,
          'underperformance',
          `${bottomUnderlying[0]} is underperforming: ${bottomUnderlying[1].winRate.toFixed(1)}% win rate`,
          bottomUnderlying[1],
          overall.winRate,
          bottomUnderlying[1].winRate,
          `Review or reduce ${bottomUnderlying[0]} trades`
        );
      }
    }

    // Sort patterns by significance and absolute difference
    patterns.sort((a, b) => {
      const sigOrder = { high: 0, medium: 1, low: 2 };
      if (sigOrder[a.significance] !== sigOrder[b.significance]) {
        return sigOrder[a.significance] - sigOrder[b.significance];
      }
      return Math.abs(b.metrics.differencePercent) - Math.abs(a.metrics.differencePercent);
    });

    return patterns;
  }

  // ===========================================================================
  // Private Methods - Persistence
  // ===========================================================================

  private getDataFilePath(accountId: string): string {
    const safeAccountId = accountId.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.dataDir, `performance-${safeAccountId}.json`);
  }

  private async loadAllTrades(): Promise<void> {
    if (!fs.existsSync(this.dataDir)) {
      return;
    }

    const files = fs.readdirSync(this.dataDir);
    for (const file of files) {
      if (file.startsWith('performance-') && file.endsWith('.json')) {
        await this.loadDataFile(path.join(this.dataDir, file));
      }
    }
  }

  private async loadDataFile(filePath: string): Promise<void> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const dataFile: PerformanceDataFile = JSON.parse(fileContent);

      for (const [tradeId, encryptedData] of Object.entries(dataFile.trades)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const storedTrade = JSON.parse(decrypted, (key, value) => {
            // Parse date strings back to Date objects
            if (key === 'entryDate' || key === 'exitDate' || key === 'createdAt') {
              return new Date(value);
            }
            return value;
          }) as StoredClosedTrade;

          const accountId = storedTrade.accountId;
          const accountTrades = this.trades.get(accountId) ?? [];
          accountTrades.push(storedTrade);
          this.trades.set(accountId, accountTrades);
        } catch {
          this.logger.error(`Failed to decrypt trade ${tradeId}`);
        }
      }
    } catch {
      this.logger.error(`Failed to load data file ${filePath}`);
    }
  }

  private async saveAccountTrades(accountId: string): Promise<void> {
    const accountTrades = this.trades.get(accountId);
    if (!accountTrades || accountTrades.length === 0) {
      const filePath = this.getDataFilePath(accountId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    const dataFile: PerformanceDataFile = {
      version: PERFORMANCE_SCHEMA_VERSION,
      trades: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tradeCount: accountTrades.length,
      },
    };

    for (const trade of accountTrades) {
      const plaintext = JSON.stringify(trade);
      dataFile.trades[trade.id] = encrypt(plaintext, this.masterPassword);
    }

    const filePath = this.getDataFilePath(accountId);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Write with restrictive permissions using temp file
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(dataFile, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  }

  /**
   * Clear all in-memory data (for shutdown/testing)
   */
  clearMemory(): void {
    this.trades.clear();
    this.initialized = false;
  }

  /**
   * Delete all trades for an account (for testing)
   */
  async clearAccount(accountId: string): Promise<void> {
    this.trades.delete(accountId);
    const filePath = this.getDataFilePath(accountId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create PerformanceAttributionService from environment variables
 */
export async function createPerformanceAttributionServiceFromEnv(
  masterPasswordEnvVar: string = 'SECRETS_MASTER_PASSWORD',
  dataDirEnvVar: string = 'PERFORMANCE_DATA_DIR'
): Promise<PerformanceAttributionService> {
  const masterPassword = process.env[masterPasswordEnvVar];

  if (!masterPassword) {
    throw new Error(
      `Master password not found. Set the ${masterPasswordEnvVar} environment variable.`
    );
  }

  const dataDir = process.env[dataDirEnvVar] || DEFAULT_DATA_DIR;

  const service = new PerformanceAttributionService({
    masterPassword,
    dataDir,
  });

  await service.initialize();

  return service;
}

/**
 * Create a PerformanceAttributionService instance
 */
export function createPerformanceAttributionService(
  options: PerformanceAttributionServiceOptions,
  logger?: PerformanceAttributionLogger
): PerformanceAttributionService {
  return new PerformanceAttributionService(options, logger);
}
