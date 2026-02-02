/**
 * Alert Monitoring Service
 *
 * Monitors market conditions and portfolio state to trigger alerts
 * when key events occur. Supports polling-based monitoring with
 * configurable intervals and user-defined triggers.
 *
 * Key features:
 * - Multiple trigger types (price moves, premium targets, earnings, spreads, drawdown)
 * - User configurable alert preferences
 * - Generates recommended actions with alerts
 * - In-memory storage with optional persistence
 * - Polling-based monitoring (webhook support can be added later)
 */

import { randomUUID } from 'crypto';
import type { BrokerAdapter, Position, AccountSummary, Quote } from '../types/broker.js';
import type { AuditLogService } from './audit-log.js';
import type { MarketDataService } from './market-data.js';
import {
  type AlertTriggerType,
  type AlertSeverity,
  type AlertStatus,
  type AlertTrigger,
  type AlertTriggerConfig,
  type StoredAlertTrigger,
  type AlertEvent,
  type StoredAlertEvent,
  type AlertContext,
  type AlertPreferences,
  type AlertRecommendedAction,
  type UnderlyingMoveConfig,
  type PremiumTargetConfig,
  type EarningsApproachingConfig,
  type BidAskWideningConfig,
  type PortfolioDrawdownConfig,
  DEFAULT_ALERT_PREFERENCES,
  ALERTS_SCHEMA_VERSION,
  determineAlertSeverity,
  generateRecommendedActions,
  generateAlertTitle,
  generateAlertMessage,
  shouldShowAlert,
  validateAlertTrigger,
} from '../types/alerts.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for the alert service
 */
export interface AlertServiceLogger {
  debug?: (message: string, data?: unknown) => void;
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
}

/**
 * Configuration for the alert monitoring service
 */
export interface AlertMonitorConfig {
  /** Polling interval in milliseconds (default: 60000 = 1 minute) */
  pollingIntervalMs?: number;
  /** Maximum alerts to keep in memory (default: 100) */
  maxAlerts?: number;
  /** Maximum triggers per account (default: 50) */
  maxTriggers?: number;
  /** Logger for debug output */
  logger?: AlertServiceLogger;
  /** Initial preferences (uses defaults if not provided) */
  preferences?: Partial<AlertPreferences>;
}

/**
 * Result of a monitoring scan
 */
export interface AlertScanResult {
  /** Number of triggers evaluated */
  triggersEvaluated: number;
  /** Number of alerts generated */
  alertsGenerated: number;
  /** Generated alerts */
  alerts: AlertEvent[];
  /** Triggers that were skipped (disabled or error) */
  skipped: Array<{ triggerId: string; reason: string }>;
  /** Scan timestamp */
  scannedAt: Date;
}

/**
 * Price history entry for tracking moves over time
 */
interface PriceHistoryEntry {
  symbol: string;
  price: number;
  timestamp: Date;
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Alert Monitoring Service
 *
 * Monitors market conditions and triggers alerts based on user-defined
 * rules. Supports multiple trigger types and generates recommended
 * actions with each alert.
 */
export class AlertMonitorService {
  private adapter: BrokerAdapter;
  private marketDataService: MarketDataService;
  private auditLogService?: AuditLogService;
  private accountId: string;
  private config: Required<Omit<AlertMonitorConfig, 'logger' | 'preferences'>>;
  private logger?: AlertServiceLogger;
  private preferences: AlertPreferences;

  // In-memory storage
  private triggers: Map<string, StoredAlertTrigger> = new Map();
  private alerts: Map<string, StoredAlertEvent> = new Map();
  private priceHistory: Map<string, PriceHistoryEntry[]> = new Map();

  // Polling state
  private pollingInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private lastScanAt?: Date;

  constructor(
    adapter: BrokerAdapter,
    marketDataService: MarketDataService,
    accountId: string,
    config: AlertMonitorConfig = {},
    auditLogService?: AuditLogService
  ) {
    this.adapter = adapter;
    this.marketDataService = marketDataService;
    this.auditLogService = auditLogService;
    this.accountId = accountId;
    this.config = {
      pollingIntervalMs: config.pollingIntervalMs ?? 60000, // 1 minute
      maxAlerts: config.maxAlerts ?? 100,
      maxTriggers: config.maxTriggers ?? 50,
    };
    this.logger = config.logger;
    this.preferences = {
      ...DEFAULT_ALERT_PREFERENCES,
      ...config.preferences,
      accountId,
    };

    this.logger?.info?.('[ALERT MONITOR] Service initialized', {
      accountId,
      pollingIntervalMs: this.config.pollingIntervalMs,
      maxAlerts: this.config.maxAlerts,
      maxTriggers: this.config.maxTriggers,
    });
  }

  // ============================================================================
  // Trigger Management
  // ============================================================================

  /**
   * Create a new alert trigger
   */
  createTrigger(
    name: string,
    description: string,
    config: AlertTriggerConfig
  ): StoredAlertTrigger {
    // Validate the config
    const validation = validateAlertTrigger(config);
    if (!validation.valid) {
      throw new Error(`Invalid trigger config: ${validation.errors.join(', ')}`);
    }

    // Check max triggers limit
    if (this.triggers.size >= this.config.maxTriggers) {
      throw new Error(`Maximum triggers limit (${this.config.maxTriggers}) reached`);
    }

    const now = new Date();
    const trigger: StoredAlertTrigger = {
      id: randomUUID(),
      accountId: this.accountId,
      name,
      description,
      enabled: true,
      config,
      createdAt: now,
      updatedAt: now,
      fireCount: 0,
      version: ALERTS_SCHEMA_VERSION,
    };

    this.triggers.set(trigger.id, trigger);

    this.logger?.info?.('[ALERT MONITOR] Trigger created', {
      triggerId: trigger.id,
      name,
      type: config.type,
    });

    // Log to audit
    this.auditLogService?.log({
      eventType: 'config_change',
      actor: 'user',
      accountId: this.accountId,
      details: {
        type: 'config_change',
        configType: 'alerts',
        field: 'triggers',
        newValue: `created:${trigger.id}`,
        configId: trigger.id,
      },
      summary: `Created alert trigger: ${name}`,
    });

    return trigger;
  }

  /**
   * Update an existing trigger
   */
  updateTrigger(
    triggerId: string,
    updates: Partial<Pick<AlertTrigger, 'name' | 'description' | 'enabled' | 'config'>>
  ): StoredAlertTrigger {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) {
      throw new Error(`Trigger not found: ${triggerId}`);
    }

    // Validate new config if provided
    if (updates.config) {
      const validation = validateAlertTrigger(updates.config);
      if (!validation.valid) {
        throw new Error(`Invalid trigger config: ${validation.errors.join(', ')}`);
      }
    }

    const updated: StoredAlertTrigger = {
      ...trigger,
      ...updates,
      updatedAt: new Date(),
    };

    this.triggers.set(triggerId, updated);

    this.logger?.info?.('[ALERT MONITOR] Trigger updated', {
      triggerId,
      updates: Object.keys(updates),
    });

    return updated;
  }

  /**
   * Delete a trigger
   */
  deleteTrigger(triggerId: string): boolean {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) {
      return false;
    }

    this.triggers.delete(triggerId);

    this.logger?.info?.('[ALERT MONITOR] Trigger deleted', { triggerId });

    // Log to audit
    this.auditLogService?.log({
      eventType: 'config_change',
      actor: 'user',
      accountId: this.accountId,
      details: {
        type: 'config_change',
        configType: 'alerts',
        field: 'triggers',
        previousValue: `deleted:${triggerId}`,
        newValue: 'none',
        configId: triggerId,
      },
      summary: `Deleted alert trigger: ${trigger.name}`,
    });

    return true;
  }

  /**
   * Get a trigger by ID
   */
  getTrigger(triggerId: string): StoredAlertTrigger | undefined {
    return this.triggers.get(triggerId);
  }

  /**
   * Get all triggers
   */
  getAllTriggers(): StoredAlertTrigger[] {
    return Array.from(this.triggers.values());
  }

  /**
   * Get triggers by type
   */
  getTriggersByType(type: AlertTriggerType): StoredAlertTrigger[] {
    return Array.from(this.triggers.values()).filter(
      (t) => t.config.type === type
    );
  }

  /**
   * Enable a trigger
   */
  enableTrigger(triggerId: string): StoredAlertTrigger {
    return this.updateTrigger(triggerId, { enabled: true });
  }

  /**
   * Disable a trigger
   */
  disableTrigger(triggerId: string): StoredAlertTrigger {
    return this.updateTrigger(triggerId, { enabled: false });
  }

  // ============================================================================
  // Alert Management
  // ============================================================================

  /**
   * Get an alert by ID
   */
  getAlert(alertId: string): StoredAlertEvent | undefined {
    return this.alerts.get(alertId);
  }

  /**
   * Get all alerts
   */
  getAllAlerts(): StoredAlertEvent[] {
    return Array.from(this.alerts.values()).sort(
      (a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime()
    );
  }

  /**
   * Get active alerts (not dismissed or resolved)
   */
  getActiveAlerts(): StoredAlertEvent[] {
    return this.getAllAlerts().filter(
      (a) => a.status === 'active' || a.status === 'acknowledged'
    );
  }

  /**
   * Get visible alerts based on preferences
   */
  getVisibleAlerts(): StoredAlertEvent[] {
    return this.getAllAlerts().filter((a) => shouldShowAlert(a, this.preferences));
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string): StoredAlertEvent | null {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;

    if (alert.status !== 'active') {
      this.logger?.warn?.('[ALERT MONITOR] Cannot acknowledge non-active alert', {
        alertId,
        currentStatus: alert.status,
      });
      return alert;
    }

    const updated: StoredAlertEvent = {
      ...alert,
      status: 'acknowledged',
      acknowledgedAt: new Date(),
    };

    this.alerts.set(alertId, updated);

    this.logger?.info?.('[ALERT MONITOR] Alert acknowledged', { alertId });

    return updated;
  }

  /**
   * Dismiss an alert
   */
  dismissAlert(alertId: string): StoredAlertEvent | null {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;

    const updated: StoredAlertEvent = {
      ...alert,
      status: 'dismissed',
      dismissedAt: new Date(),
    };

    this.alerts.set(alertId, updated);

    this.logger?.info?.('[ALERT MONITOR] Alert dismissed', { alertId });

    return updated;
  }

  /**
   * Add user notes to an alert
   */
  addNotesToAlert(alertId: string, notes: string): StoredAlertEvent | null {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;

    const updated: StoredAlertEvent = {
      ...alert,
      userNotes: notes,
    };

    this.alerts.set(alertId, updated);

    return updated;
  }

  /**
   * Dismiss all alerts
   */
  dismissAllAlerts(): number {
    let count = 0;
    const now = new Date();

    for (const [id, alert] of this.alerts) {
      if (alert.status !== 'dismissed') {
        this.alerts.set(id, {
          ...alert,
          status: 'dismissed',
          dismissedAt: now,
        });
        count++;
      }
    }

    this.logger?.info?.('[ALERT MONITOR] All alerts dismissed', { count });

    return count;
  }

  /**
   * Clear old dismissed alerts
   */
  clearOldAlerts(): number {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - this.preferences.dismissedRetentionHours);

    let count = 0;
    for (const [id, alert] of this.alerts) {
      if (
        alert.status === 'dismissed' &&
        alert.dismissedAt &&
        alert.dismissedAt < cutoff
      ) {
        this.alerts.delete(id);
        count++;
      }
    }

    if (count > 0) {
      this.logger?.info?.('[ALERT MONITOR] Cleared old alerts', { count });
    }

    return count;
  }

  // ============================================================================
  // Polling Control
  // ============================================================================

  /**
   * Start polling for alerts
   */
  startPolling(): void {
    if (this.isPolling) {
      this.logger?.warn?.('[ALERT MONITOR] Polling already started');
      return;
    }

    this.isPolling = true;

    this.pollingInterval = setInterval(async () => {
      try {
        await this.scan();
      } catch (error) {
        this.logger?.error?.('[ALERT MONITOR] Polling scan error', { error });
      }
    }, this.config.pollingIntervalMs);

    this.logger?.info?.('[ALERT MONITOR] Polling started', {
      intervalMs: this.config.pollingIntervalMs,
    });

    // Run initial scan immediately
    this.scan().catch((error) => {
      this.logger?.error?.('[ALERT MONITOR] Initial scan error', { error });
    });
  }

  /**
   * Stop polling for alerts
   */
  stopPolling(): void {
    if (!this.isPolling) {
      return;
    }

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    this.isPolling = false;

    this.logger?.info?.('[ALERT MONITOR] Polling stopped');
  }

  /**
   * Check if polling is active
   */
  isPollingActive(): boolean {
    return this.isPolling;
  }

  /**
   * Get last scan timestamp
   */
  getLastScanTime(): Date | undefined {
    return this.lastScanAt;
  }

  // ============================================================================
  // Alert Scanning
  // ============================================================================

  /**
   * Scan all triggers and generate alerts
   */
  async scan(): Promise<AlertScanResult> {
    if (!this.preferences.alertsEnabled) {
      return {
        triggersEvaluated: 0,
        alertsGenerated: 0,
        alerts: [],
        skipped: [],
        scannedAt: new Date(),
      };
    }

    const now = new Date();
    this.lastScanAt = now;

    const enabledTriggers = Array.from(this.triggers.values()).filter(
      (t) => t.enabled
    );

    this.logger?.debug?.('[ALERT MONITOR] Starting scan', {
      triggerCount: enabledTriggers.length,
    });

    const generatedAlerts: AlertEvent[] = [];
    const skipped: Array<{ triggerId: string; reason: string }> = [];

    // Fetch account and positions once for all triggers
    let account: AccountSummary | null = null;
    let positions: Position[] = [];

    try {
      [account, positions] = await Promise.all([
        this.adapter.getAccountSummary(),
        this.adapter.getPositions(),
      ]);
    } catch (error) {
      this.logger?.error?.('[ALERT MONITOR] Failed to fetch account data', { error });
    }

    for (const trigger of enabledTriggers) {
      try {
        const alert = await this.evaluateTrigger(trigger, now, account, positions);
        if (alert) {
          generatedAlerts.push(alert);
          this.storeAlert(alert);

          // Update trigger fire count
          const updated: StoredAlertTrigger = {
            ...trigger,
            fireCount: trigger.fireCount + 1,
            lastFiredAt: now,
            updatedAt: now,
          };
          this.triggers.set(trigger.id, updated);

          // Log to audit
          this.auditLogService?.log({
            eventType: 'recommendation',
            actor: 'agent',
            accountId: this.accountId,
            details: {
              type: 'recommendation',
              strategyType: `alert:${trigger.config.type}`,
              underlying: alert.context.position?.symbol ?? (trigger.config.type === 'underlying_move'
                ? (trigger.config as UnderlyingMoveConfig).symbol
                : trigger.config.type === 'earnings_approaching'
                  ? (trigger.config as EarningsApproachingConfig).symbol
                  : 'portfolio'),
              confidence: alert.severity === 'critical' ? 'high' : alert.severity === 'warning' ? 'medium' : 'low',
              thesis: [alert.message],
              catalysts: [alert.title],
              contractCount: 0,
            },
            summary: `Alert triggered: ${alert.title}`,
          });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error';
        skipped.push({ triggerId: trigger.id, reason });
        this.logger?.warn?.('[ALERT MONITOR] Error evaluating trigger', {
          triggerId: trigger.id,
          error: reason,
        });
      }
    }

    // Clean up old alerts
    this.clearOldAlerts();

    // Enforce max alerts limit
    this.enforceMaxAlerts();

    const result: AlertScanResult = {
      triggersEvaluated: enabledTriggers.length,
      alertsGenerated: generatedAlerts.length,
      alerts: generatedAlerts,
      skipped,
      scannedAt: now,
    };

    this.logger?.info?.('[ALERT MONITOR] Scan complete', {
      triggersEvaluated: result.triggersEvaluated,
      alertsGenerated: result.alertsGenerated,
      skippedCount: result.skipped.length,
    });

    return result;
  }

  /**
   * Evaluate a single trigger
   */
  private async evaluateTrigger(
    trigger: StoredAlertTrigger,
    now: Date,
    account: AccountSummary | null,
    positions: Position[]
  ): Promise<AlertEvent | null> {
    const config = trigger.config;

    switch (config.type) {
      case 'underlying_move':
        return this.evaluateUnderlyingMove(trigger, config, now);

      case 'premium_target':
        return this.evaluatePremiumTarget(trigger, config, positions, now);

      case 'earnings_approaching':
        return this.evaluateEarningsApproaching(trigger, config, now);

      case 'bid_ask_widening':
        return this.evaluateBidAskWidening(trigger, config, positions, now);

      case 'portfolio_drawdown':
        return this.evaluatePortfolioDrawdown(trigger, config, account, now);

      default:
        this.logger?.warn?.('[ALERT MONITOR] Unknown trigger type', {
          triggerId: trigger.id,
          type: (config as AlertTriggerConfig).type,
        });
        return null;
    }
  }

  /**
   * Evaluate underlying price move trigger
   */
  private async evaluateUnderlyingMove(
    trigger: StoredAlertTrigger,
    config: UnderlyingMoveConfig,
    now: Date
  ): Promise<AlertEvent | null> {
    const quote = await this.marketDataService.getQuote(config.symbol);

    // Track price history
    const history = this.priceHistory.get(config.symbol) ?? [];
    history.push({ symbol: config.symbol, price: quote.last, timestamp: now });

    // Trim old history entries
    const windowStart = new Date(now.getTime() - config.timeWindowMinutes * 60 * 1000);
    const trimmedHistory = history.filter((h) => h.timestamp >= windowStart);
    this.priceHistory.set(config.symbol, trimmedHistory);

    // Need at least 2 data points to compare
    if (trimmedHistory.length < 2) {
      return null;
    }

    // Find the oldest price in the window (we know it exists because length >= 2)
    const oldestEntry = trimmedHistory[0]!;
    const priceChange = quote.last - oldestEntry.price;
    const priceChangePercent = oldestEntry.price > 0 ? (priceChange / oldestEntry.price) * 100 : 0;

    // Check if the move exceeds threshold
    const absMovePercent = Math.abs(priceChangePercent);
    if (absMovePercent < config.movePercent) {
      return null;
    }

    // Check direction filter
    if (config.direction === 'up' && priceChangePercent < 0) {
      return null;
    }
    if (config.direction === 'down' && priceChangePercent > 0) {
      return null;
    }

    // Build context
    const context: AlertContext = {
      currentPrice: quote.last,
      previousPrice: oldestEntry.price,
      priceChange,
      priceChangePercent,
      bid: quote.bid,
      ask: quote.ask,
    };

    const severity = determineAlertSeverity('underlying_move', context);
    const actions = generateRecommendedActions('underlying_move', context, config);
    const title = generateAlertTitle('underlying_move', config, context);
    const message = generateAlertMessage('underlying_move', config, context);

    return this.createAlertEvent(trigger, 'underlying_move', severity, title, message, context, actions, now);
  }

  /**
   * Evaluate premium target trigger
   */
  private async evaluatePremiumTarget(
    trigger: StoredAlertTrigger,
    config: PremiumTargetConfig,
    positions: Position[],
    now: Date
  ): Promise<AlertEvent | null> {
    // Find the position
    let position: Position | undefined;
    if (config.positionId) {
      position = positions.find((p) => p.id === config.positionId);
    } else if (config.symbol) {
      position = positions.find((p) => p.symbol === config.symbol);
    }

    if (!position) {
      return null;
    }

    // Calculate P&L percentage
    const pnlPercent = position.averageCost > 0
      ? ((position.currentPrice - position.averageCost) / position.averageCost) * 100
      : 0;

    // Check if target is hit
    const profitTargetHit = pnlPercent >= config.targetProfitPercent;
    const lossTargetHit = config.targetLossPercent !== undefined && pnlPercent <= config.targetLossPercent;

    if (!profitTargetHit && !lossTargetHit) {
      return null;
    }

    // Build context
    const context: AlertContext = {
      position: {
        symbol: position.symbol,
        quantity: position.quantity,
        avgCost: position.averageCost,
        currentValue: position.marketValue,
        unrealizedPnL: position.unrealizedPnL,
        unrealizedPnLPercent: pnlPercent,
      },
    };

    const severity = determineAlertSeverity('premium_target', context);
    const actions = generateRecommendedActions('premium_target', context, config);
    const title = generateAlertTitle('premium_target', config, context);
    const message = generateAlertMessage('premium_target', config, context);

    return this.createAlertEvent(trigger, 'premium_target', severity, title, message, context, actions, now);
  }

  /**
   * Evaluate earnings approaching trigger
   *
   * Note: In a production system, this would integrate with an earnings
   * calendar API. For now, we use a placeholder that always returns null
   * unless mock earnings data is provided.
   */
  private async evaluateEarningsApproaching(
    trigger: StoredAlertTrigger,
    config: EarningsApproachingConfig,
    now: Date
  ): Promise<AlertEvent | null> {
    // Placeholder: In production, fetch earnings date from API
    // For now, check if we have mock earnings data stored
    const mockEarningsDate = this.getMockEarningsDate(config.symbol);
    if (!mockEarningsDate) {
      return null;
    }

    const daysUntilEarnings = Math.ceil(
      (mockEarningsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Only alert if within the configured days threshold
    if (daysUntilEarnings > config.daysBeforeEarnings || daysUntilEarnings < 0) {
      return null;
    }

    // Build context
    const context: AlertContext = {
      daysUntilEarnings,
      earningsDate: mockEarningsDate.toISOString().split('T')[0],
    };

    const severity = determineAlertSeverity('earnings_approaching', context);
    const actions = generateRecommendedActions('earnings_approaching', context, config);
    const title = generateAlertTitle('earnings_approaching', config, context);
    const message = generateAlertMessage('earnings_approaching', config, context);

    return this.createAlertEvent(trigger, 'earnings_approaching', severity, title, message, context, actions, now);
  }

  /**
   * Evaluate bid-ask widening trigger
   */
  private async evaluateBidAskWidening(
    trigger: StoredAlertTrigger,
    config: BidAskWideningConfig,
    positions: Position[],
    now: Date
  ): Promise<AlertEvent | null> {
    let symbol: string | undefined;
    let position: Position | undefined;

    if (config.positionId) {
      position = positions.find((p) => p.id === config.positionId);
      symbol = position?.symbol;
    } else if (config.symbol) {
      symbol = config.symbol;
      position = positions.find((p) => p.symbol === symbol);
    }

    if (!symbol) {
      return null;
    }

    const quote = await this.marketDataService.getQuote(symbol);
    const mid = quote.mid > 0 ? quote.mid : (quote.bid + quote.ask) / 2;
    const spreadPercent = mid > 0 ? ((quote.ask - quote.bid) / mid) * 100 : 0;

    if (spreadPercent < config.spreadThresholdPercent) {
      return null;
    }

    // Build context
    const context: AlertContext = {
      currentPrice: quote.last,
      bid: quote.bid,
      ask: quote.ask,
      spreadPercent,
      position: position
        ? {
            symbol: position.symbol,
            quantity: position.quantity,
            avgCost: position.averageCost,
            currentValue: position.marketValue,
            unrealizedPnL: position.unrealizedPnL,
            unrealizedPnLPercent:
              position.averageCost > 0
                ? ((position.currentPrice - position.averageCost) / position.averageCost) * 100
                : 0,
          }
        : undefined,
    };

    const severity = determineAlertSeverity('bid_ask_widening', context);
    const actions = generateRecommendedActions('bid_ask_widening', context, config);
    const title = generateAlertTitle('bid_ask_widening', config, context);
    const message = generateAlertMessage('bid_ask_widening', config, context);

    return this.createAlertEvent(trigger, 'bid_ask_widening', severity, title, message, context, actions, now);
  }

  /**
   * Evaluate portfolio drawdown trigger
   */
  private async evaluatePortfolioDrawdown(
    trigger: StoredAlertTrigger,
    config: PortfolioDrawdownConfig,
    account: AccountSummary | null,
    now: Date
  ): Promise<AlertEvent | null> {
    if (!account) {
      return null;
    }

    // Calculate percentages
    const dailyPnLPercent = account.netLiquidation > 0
      ? (account.dailyPnL / account.netLiquidation) * 100
      : 0;

    const unrealizedPnLPercent = account.netLiquidation > 0
      ? (account.unrealizedPnL / account.netLiquidation) * 100
      : 0;

    // Check thresholds
    let triggered = false;

    if (config.maxDailyLossAmount !== undefined && account.dailyPnL <= -config.maxDailyLossAmount) {
      triggered = true;
    }
    if (config.maxDailyLossPercent !== undefined && dailyPnLPercent <= -config.maxDailyLossPercent) {
      triggered = true;
    }
    if (config.maxUnrealizedLossPercent !== undefined && unrealizedPnLPercent <= -config.maxUnrealizedLossPercent) {
      triggered = true;
    }

    if (!triggered) {
      return null;
    }

    // Build context
    const context: AlertContext = {
      portfolio: {
        totalValue: account.netLiquidation,
        dailyPnL: account.dailyPnL,
        dailyPnLPercent,
        unrealizedPnL: account.unrealizedPnL,
        unrealizedPnLPercent,
      },
    };

    const severity = determineAlertSeverity('portfolio_drawdown', context);
    const actions = generateRecommendedActions('portfolio_drawdown', context, config);
    const title = generateAlertTitle('portfolio_drawdown', config, context);
    const message = generateAlertMessage('portfolio_drawdown', config, context);

    return this.createAlertEvent(trigger, 'portfolio_drawdown', severity, title, message, context, actions, now);
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Create an alert event
   */
  private createAlertEvent(
    trigger: StoredAlertTrigger,
    triggerType: AlertTriggerType,
    severity: AlertSeverity,
    title: string,
    message: string,
    context: AlertContext,
    recommendedActions: AlertRecommendedAction[],
    now: Date
  ): AlertEvent {
    return {
      id: randomUUID(),
      accountId: this.accountId,
      triggerId: trigger.id,
      triggerName: trigger.name,
      triggerType,
      severity,
      status: 'active',
      title,
      message,
      context,
      recommendedActions,
      triggeredAt: now,
    };
  }

  /**
   * Store an alert in memory
   */
  private storeAlert(alert: AlertEvent): void {
    const stored: StoredAlertEvent = {
      ...alert,
      version: ALERTS_SCHEMA_VERSION,
    };
    this.alerts.set(alert.id, stored);
  }

  /**
   * Enforce maximum alerts limit by removing oldest dismissed/resolved
   */
  private enforceMaxAlerts(): void {
    if (this.alerts.size <= this.config.maxAlerts) {
      return;
    }

    // Sort by priority: active > acknowledged > resolved > dismissed
    // Then by date (newest first)
    const sorted = Array.from(this.alerts.values()).sort((a, b) => {
      const statusPriority: Record<AlertStatus, number> = {
        active: 0,
        acknowledged: 1,
        resolved: 2,
        dismissed: 3,
      };
      const aPriority = statusPriority[a.status];
      const bPriority = statusPriority[b.status];
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return b.triggeredAt.getTime() - a.triggeredAt.getTime();
    });

    // Keep the top maxAlerts
    const toRemove = sorted.slice(this.config.maxAlerts);
    for (const alert of toRemove) {
      this.alerts.delete(alert.id);
    }
  }

  /**
   * Mock earnings date storage (for testing/demo)
   */
  private mockEarningsDates: Map<string, Date> = new Map();

  /**
   * Set mock earnings date for testing
   */
  setMockEarningsDate(symbol: string, date: Date): void {
    this.mockEarningsDates.set(symbol.toUpperCase(), date);
  }

  /**
   * Get mock earnings date
   */
  private getMockEarningsDate(symbol: string): Date | undefined {
    return this.mockEarningsDates.get(symbol.toUpperCase());
  }

  // ============================================================================
  // Preferences
  // ============================================================================

  /**
   * Get current preferences
   */
  getPreferences(): AlertPreferences {
    return { ...this.preferences };
  }

  /**
   * Update preferences
   */
  updatePreferences(updates: Partial<AlertPreferences>): AlertPreferences {
    this.preferences = {
      ...this.preferences,
      ...updates,
      accountId: this.accountId, // Don't allow changing accountId
    };

    this.logger?.info?.('[ALERT MONITOR] Preferences updated', {
      updates: Object.keys(updates),
    });

    return this.getPreferences();
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get alert statistics
   */
  getStatistics(): {
    totalTriggers: number;
    enabledTriggers: number;
    totalAlerts: number;
    activeAlerts: number;
    acknowledgedAlerts: number;
    dismissedAlerts: number;
    resolvedAlerts: number;
    alertsBySeverity: Record<AlertSeverity, number>;
    alertsByType: Partial<Record<AlertTriggerType, number>>;
    lastScanAt?: Date;
    isPolling: boolean;
  } {
    const alerts = Array.from(this.alerts.values());
    const triggers = Array.from(this.triggers.values());

    const alertsBySeverity: Record<AlertSeverity, number> = {
      info: 0,
      warning: 0,
      critical: 0,
    };

    const alertsByType: Partial<Record<AlertTriggerType, number>> = {};

    for (const alert of alerts) {
      alertsBySeverity[alert.severity]++;
      alertsByType[alert.triggerType] = (alertsByType[alert.triggerType] ?? 0) + 1;
    }

    return {
      totalTriggers: triggers.length,
      enabledTriggers: triggers.filter((t) => t.enabled).length,
      totalAlerts: alerts.length,
      activeAlerts: alerts.filter((a) => a.status === 'active').length,
      acknowledgedAlerts: alerts.filter((a) => a.status === 'acknowledged').length,
      dismissedAlerts: alerts.filter((a) => a.status === 'dismissed').length,
      resolvedAlerts: alerts.filter((a) => a.status === 'resolved').length,
      alertsBySeverity,
      alertsByType,
      lastScanAt: this.lastScanAt,
      isPolling: this.isPolling,
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopPolling();
    this.triggers.clear();
    this.alerts.clear();
    this.priceHistory.clear();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an alert monitoring service
 */
export function createAlertMonitorService(
  adapter: BrokerAdapter,
  marketDataService: MarketDataService,
  accountId: string,
  config?: AlertMonitorConfig,
  auditLogService?: AuditLogService
): AlertMonitorService {
  return new AlertMonitorService(
    adapter,
    marketDataService,
    accountId,
    config,
    auditLogService
  );
}

/**
 * Standalone function to evaluate a single trigger (for testing)
 */
export async function evaluateAlertTrigger(
  trigger: AlertTrigger,
  adapter: BrokerAdapter,
  marketDataService: MarketDataService
): Promise<AlertEvent | null> {
  const service = createAlertMonitorService(
    adapter,
    marketDataService,
    trigger.accountId
  );

  // Add the trigger
  service.createTrigger(trigger.name, trigger.description, trigger.config);

  // Scan
  const result = await service.scan();

  // Cleanup
  service.destroy();

  return result.alerts[0] ?? null;
}
