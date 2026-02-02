/**
 * Event-Driven Alert Types
 *
 * Defines types and schemas for the event-driven alert system.
 * The alert system monitors market conditions and portfolio state
 * to trigger notifications when key events occur.
 */

import { z } from 'zod';
import type { Position } from './broker.js';

// ============================================================================
// Alert Trigger Types
// ============================================================================

/**
 * Types of alert triggers supported by the system
 */
export type AlertTriggerType =
  | 'underlying_move' // Significant price movement in underlying
  | 'premium_target' // Option premium hits profit target
  | 'earnings_approaching' // Earnings report coming up
  | 'bid_ask_widening' // Spread has widened significantly
  | 'portfolio_drawdown'; // Total portfolio loss exceeds limit

/**
 * Severity level of an alert
 */
export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Status of an alert
 */
export type AlertStatus =
  | 'active' // Alert is currently firing
  | 'acknowledged' // User acknowledged but not dismissed
  | 'dismissed' // User dismissed the alert
  | 'resolved'; // Condition no longer true

// ============================================================================
// Alert Trigger Configurations
// ============================================================================

/**
 * Configuration for underlying price movement alerts
 */
export interface UnderlyingMoveConfig {
  type: 'underlying_move';
  /** Symbol to monitor */
  symbol: string;
  /** Price change percentage to trigger alert (e.g., 5 for 5%) */
  movePercent: number;
  /** Direction to watch: 'up', 'down', or 'both' */
  direction: 'up' | 'down' | 'both';
  /** Time window in minutes for the move (default: 1440 = 1 day) */
  timeWindowMinutes: number;
}

/**
 * Configuration for premium target alerts
 */
export interface PremiumTargetConfig {
  type: 'premium_target';
  /** Position ID or symbol to monitor */
  positionId?: string;
  symbol?: string;
  /** Profit target percentage (e.g., 50 for +50%) */
  targetProfitPercent: number;
  /** Optional loss target percentage (e.g., -50 for 50% loss) */
  targetLossPercent?: number;
}

/**
 * Configuration for earnings approach alerts
 */
export interface EarningsApproachingConfig {
  type: 'earnings_approaching';
  /** Symbol to monitor */
  symbol: string;
  /** Days before earnings to trigger alert */
  daysBeforeEarnings: number;
}

/**
 * Configuration for bid-ask widening alerts
 */
export interface BidAskWideningConfig {
  type: 'bid_ask_widening';
  /** Symbol or position ID to monitor */
  symbol?: string;
  positionId?: string;
  /** Spread threshold percentage to trigger alert */
  spreadThresholdPercent: number;
}

/**
 * Configuration for portfolio drawdown alerts
 */
export interface PortfolioDrawdownConfig {
  type: 'portfolio_drawdown';
  /** Maximum daily loss as dollar amount */
  maxDailyLossAmount?: number;
  /** Maximum daily loss as percentage of portfolio */
  maxDailyLossPercent?: number;
  /** Maximum total unrealized loss percentage */
  maxUnrealizedLossPercent?: number;
}

/**
 * Union type for all trigger configurations
 */
export type AlertTriggerConfig =
  | UnderlyingMoveConfig
  | PremiumTargetConfig
  | EarningsApproachingConfig
  | BidAskWideningConfig
  | PortfolioDrawdownConfig;

// ============================================================================
// Alert Definition
// ============================================================================

/**
 * A user-defined alert trigger
 */
export interface AlertTrigger {
  /** Unique ID for this trigger */
  id: string;
  /** Account ID */
  accountId: string;
  /** Human-readable name for the alert */
  name: string;
  /** Description of what this alert monitors */
  description: string;
  /** Whether this trigger is enabled */
  enabled: boolean;
  /** The trigger configuration */
  config: AlertTriggerConfig;
  /** When the trigger was created */
  createdAt: Date;
  /** When the trigger was last modified */
  updatedAt: Date;
  /** Number of times this trigger has fired */
  fireCount: number;
  /** When this trigger last fired */
  lastFiredAt?: Date;
}

/**
 * Stored alert trigger with version for migrations
 */
export interface StoredAlertTrigger extends AlertTrigger {
  /** Storage version for schema migrations */
  version: number;
}

// ============================================================================
// Alert Event (Fired Alert)
// ============================================================================

/**
 * Recommended action when an alert fires
 */
export interface AlertRecommendedAction {
  /** Type of action: hold, trim, exit, hedge, monitor */
  action: 'hold' | 'trim' | 'exit' | 'hedge' | 'monitor';
  /** Rationale for the recommendation */
  rationale: string;
  /** Priority level */
  priority: 'high' | 'medium' | 'low';
  /** Relevant symbol(s) */
  symbols: string[];
  /** Optional position IDs affected */
  positionIds?: string[];
}

/**
 * Context data included with an alert
 */
export interface AlertContext {
  /** Current price data */
  currentPrice?: number;
  /** Previous price (for comparison) */
  previousPrice?: number;
  /** Price change amount */
  priceChange?: number;
  /** Price change percentage */
  priceChangePercent?: number;
  /** Current bid/ask if relevant */
  bid?: number;
  ask?: number;
  /** Spread percentage */
  spreadPercent?: number;
  /** Position data if relevant */
  position?: {
    symbol: string;
    quantity: number;
    avgCost: number;
    currentValue: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
  };
  /** Portfolio data if relevant */
  portfolio?: {
    totalValue: number;
    dailyPnL: number;
    dailyPnLPercent: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
  };
  /** Days until earnings if relevant */
  daysUntilEarnings?: number;
  /** Earnings date if known */
  earningsDate?: string;
}

/**
 * An alert event that has been triggered
 */
export interface AlertEvent {
  /** Unique ID for this alert event */
  id: string;
  /** Account ID */
  accountId: string;
  /** ID of the trigger that fired */
  triggerId: string;
  /** Name of the trigger */
  triggerName: string;
  /** Type of trigger */
  triggerType: AlertTriggerType;
  /** Severity of the alert */
  severity: AlertSeverity;
  /** Current status */
  status: AlertStatus;
  /** Short title for the alert */
  title: string;
  /** Detailed message */
  message: string;
  /** Context data */
  context: AlertContext;
  /** Recommended actions */
  recommendedActions: AlertRecommendedAction[];
  /** When the alert was triggered */
  triggeredAt: Date;
  /** When the alert was acknowledged */
  acknowledgedAt?: Date;
  /** When the alert was dismissed */
  dismissedAt?: Date;
  /** When the alert was resolved */
  resolvedAt?: Date;
  /** Optional user notes */
  userNotes?: string;
}

/**
 * Stored alert event with version
 */
export interface StoredAlertEvent extends AlertEvent {
  /** Storage version for schema migrations */
  version: number;
}

// ============================================================================
// Alert Preferences
// ============================================================================

/**
 * User preferences for alert notifications
 */
export interface AlertPreferences {
  /** Account ID */
  accountId: string;
  /** Whether alerts are globally enabled */
  alertsEnabled: boolean;
  /** Minimum severity to show (alerts below this are hidden) */
  minimumSeverity: AlertSeverity;
  /** Whether to auto-dismiss resolved alerts */
  autoDismissResolved: boolean;
  /** Hours to keep dismissed alerts before cleaning up */
  dismissedRetentionHours: number;
  /** Default trigger configurations for quick setup */
  defaultTriggers: {
    /** Default underlying move threshold */
    defaultMovePercent: number;
    /** Default premium target percentage */
    defaultPremiumTargetPercent: number;
    /** Default days before earnings to alert */
    defaultDaysBeforeEarnings: number;
    /** Default spread threshold */
    defaultSpreadThresholdPercent: number;
    /** Default max daily loss percentage */
    defaultMaxDailyLossPercent: number;
  };
}

/**
 * Default alert preferences
 */
export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  accountId: '',
  alertsEnabled: true,
  minimumSeverity: 'info',
  autoDismissResolved: true,
  dismissedRetentionHours: 24,
  defaultTriggers: {
    defaultMovePercent: 5,
    defaultPremiumTargetPercent: 50,
    defaultDaysBeforeEarnings: 7,
    defaultSpreadThresholdPercent: 5,
    defaultMaxDailyLossPercent: 5,
  },
};

// ============================================================================
// Zod Schemas
// ============================================================================

export const UnderlyingMoveConfigSchema = z.object({
  type: z.literal('underlying_move'),
  symbol: z.string().min(1),
  movePercent: z.number().positive().max(100),
  direction: z.enum(['up', 'down', 'both']),
  timeWindowMinutes: z.number().int().positive(),
});

export const PremiumTargetConfigSchema = z.object({
  type: z.literal('premium_target'),
  positionId: z.string().optional(),
  symbol: z.string().optional(),
  targetProfitPercent: z.number(),
  targetLossPercent: z.number().optional(),
});

export const EarningsApproachingConfigSchema = z.object({
  type: z.literal('earnings_approaching'),
  symbol: z.string().min(1),
  daysBeforeEarnings: z.number().int().positive(),
});

export const BidAskWideningConfigSchema = z.object({
  type: z.literal('bid_ask_widening'),
  symbol: z.string().optional(),
  positionId: z.string().optional(),
  spreadThresholdPercent: z.number().positive(),
});

export const PortfolioDrawdownConfigSchema = z.object({
  type: z.literal('portfolio_drawdown'),
  maxDailyLossAmount: z.number().positive().optional(),
  maxDailyLossPercent: z.number().positive().max(100).optional(),
  maxUnrealizedLossPercent: z.number().positive().max(100).optional(),
});

export const AlertTriggerConfigSchema = z.discriminatedUnion('type', [
  UnderlyingMoveConfigSchema,
  PremiumTargetConfigSchema,
  EarningsApproachingConfigSchema,
  BidAskWideningConfigSchema,
  PortfolioDrawdownConfigSchema,
]);

export const AlertTriggerSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  enabled: z.boolean(),
  config: AlertTriggerConfigSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  fireCount: z.number().int().nonnegative(),
  lastFiredAt: z.date().optional(),
});

export const StoredAlertTriggerSchema = AlertTriggerSchema.extend({
  version: z.number().int().positive(),
});

export const AlertContextSchema = z.object({
  currentPrice: z.number().optional(),
  previousPrice: z.number().optional(),
  priceChange: z.number().optional(),
  priceChangePercent: z.number().optional(),
  bid: z.number().optional(),
  ask: z.number().optional(),
  spreadPercent: z.number().optional(),
  position: z
    .object({
      symbol: z.string(),
      quantity: z.number(),
      avgCost: z.number(),
      currentValue: z.number(),
      unrealizedPnL: z.number(),
      unrealizedPnLPercent: z.number(),
    })
    .optional(),
  portfolio: z
    .object({
      totalValue: z.number(),
      dailyPnL: z.number(),
      dailyPnLPercent: z.number(),
      unrealizedPnL: z.number(),
      unrealizedPnLPercent: z.number(),
    })
    .optional(),
  daysUntilEarnings: z.number().optional(),
  earningsDate: z.string().optional(),
});

export const AlertRecommendedActionSchema = z.object({
  action: z.enum(['hold', 'trim', 'exit', 'hedge', 'monitor']),
  rationale: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  symbols: z.array(z.string()),
  positionIds: z.array(z.string()).optional(),
});

export const AlertEventSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1),
  triggerId: z.string().uuid(),
  triggerName: z.string(),
  triggerType: z.enum([
    'underlying_move',
    'premium_target',
    'earnings_approaching',
    'bid_ask_widening',
    'portfolio_drawdown',
  ]),
  severity: z.enum(['info', 'warning', 'critical']),
  status: z.enum(['active', 'acknowledged', 'dismissed', 'resolved']),
  title: z.string(),
  message: z.string(),
  context: AlertContextSchema,
  recommendedActions: z.array(AlertRecommendedActionSchema),
  triggeredAt: z.date(),
  acknowledgedAt: z.date().optional(),
  dismissedAt: z.date().optional(),
  resolvedAt: z.date().optional(),
  userNotes: z.string().optional(),
});

export const StoredAlertEventSchema = AlertEventSchema.extend({
  version: z.number().int().positive(),
});

export const AlertPreferencesSchema = z.object({
  accountId: z.string(),
  alertsEnabled: z.boolean(),
  minimumSeverity: z.enum(['info', 'warning', 'critical']),
  autoDismissResolved: z.boolean(),
  dismissedRetentionHours: z.number().int().positive(),
  defaultTriggers: z.object({
    defaultMovePercent: z.number().positive(),
    defaultPremiumTargetPercent: z.number(),
    defaultDaysBeforeEarnings: z.number().int().positive(),
    defaultSpreadThresholdPercent: z.number().positive(),
    defaultMaxDailyLossPercent: z.number().positive().max(100),
  }),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine severity based on alert type and context
 */
export function determineAlertSeverity(
  triggerType: AlertTriggerType,
  context: AlertContext
): AlertSeverity {
  switch (triggerType) {
    case 'underlying_move':
      // Large moves are more severe
      if (
        context.priceChangePercent &&
        Math.abs(context.priceChangePercent) >= 10
      ) {
        return 'critical';
      }
      if (
        context.priceChangePercent &&
        Math.abs(context.priceChangePercent) >= 5
      ) {
        return 'warning';
      }
      return 'info';

    case 'premium_target':
      // Hitting targets is generally positive, but large losses are critical
      if (
        context.position?.unrealizedPnLPercent &&
        context.position.unrealizedPnLPercent <= -50
      ) {
        return 'critical';
      }
      if (
        context.position?.unrealizedPnLPercent &&
        context.position.unrealizedPnLPercent >= 100
      ) {
        return 'warning'; // Profitable but may want to take gains
      }
      return 'info';

    case 'earnings_approaching':
      // Very close earnings are more urgent
      if (context.daysUntilEarnings !== undefined) {
        if (context.daysUntilEarnings <= 1) return 'critical';
        if (context.daysUntilEarnings <= 3) return 'warning';
      }
      return 'info';

    case 'bid_ask_widening':
      // Large spreads make exit difficult
      if (context.spreadPercent && context.spreadPercent >= 20) {
        return 'critical';
      }
      if (context.spreadPercent && context.spreadPercent >= 10) {
        return 'warning';
      }
      return 'info';

    case 'portfolio_drawdown':
      // Drawdown is always serious
      if (
        context.portfolio?.dailyPnLPercent &&
        context.portfolio.dailyPnLPercent <= -10
      ) {
        return 'critical';
      }
      if (
        context.portfolio?.dailyPnLPercent &&
        context.portfolio.dailyPnLPercent <= -5
      ) {
        return 'warning';
      }
      return 'info';

    default:
      return 'info';
  }
}

/**
 * Generate recommended actions based on alert type and context
 */
export function generateRecommendedActions(
  triggerType: AlertTriggerType,
  context: AlertContext,
  config: AlertTriggerConfig
): AlertRecommendedAction[] {
  const actions: AlertRecommendedAction[] = [];

  switch (triggerType) {
    case 'underlying_move': {
      const moveConfig = config as UnderlyingMoveConfig;
      const isUp = (context.priceChangePercent ?? 0) > 0;
      const isLargeMove = Math.abs(context.priceChangePercent ?? 0) >= 10;

      if (isLargeMove) {
        actions.push({
          action: 'monitor',
          rationale: `Large ${isUp ? 'upward' : 'downward'} move of ${Math.abs(context.priceChangePercent ?? 0).toFixed(1)}% - review positions in ${moveConfig.symbol}`,
          priority: 'high',
          symbols: [moveConfig.symbol],
        });

        if (!isUp) {
          actions.push({
            action: 'hedge',
            rationale:
              'Consider hedging or reducing exposure after significant decline',
            priority: 'medium',
            symbols: [moveConfig.symbol],
          });
        }
      } else {
        actions.push({
          action: 'monitor',
          rationale: `${moveConfig.symbol} moved ${Math.abs(context.priceChangePercent ?? 0).toFixed(1)}% - continue monitoring`,
          priority: 'low',
          symbols: [moveConfig.symbol],
        });
      }
      break;
    }

    case 'premium_target': {
      const pnlPercent = context.position?.unrealizedPnLPercent ?? 0;

      if (pnlPercent >= 100) {
        actions.push({
          action: 'trim',
          rationale: `Position has doubled (+${pnlPercent.toFixed(0)}%) - consider taking partial profits`,
          priority: 'high',
          symbols: context.position ? [context.position.symbol] : [],
        });
      } else if (pnlPercent >= 50) {
        actions.push({
          action: 'trim',
          rationale: `Strong gains (+${pnlPercent.toFixed(0)}%) - consider taking some profits`,
          priority: 'medium',
          symbols: context.position ? [context.position.symbol] : [],
        });
      } else if (pnlPercent <= -50) {
        actions.push({
          action: 'exit',
          rationale: `Significant loss (${pnlPercent.toFixed(0)}%) - consider closing to limit further losses`,
          priority: 'high',
          symbols: context.position ? [context.position.symbol] : [],
        });
      }
      break;
    }

    case 'earnings_approaching': {
      const earningsConfig = config as EarningsApproachingConfig;
      const days = context.daysUntilEarnings ?? 0;

      if (days <= 1) {
        actions.push({
          action: 'exit',
          rationale: `Earnings tomorrow - high IV crush risk. Consider closing before announcement.`,
          priority: 'high',
          symbols: [earningsConfig.symbol],
        });
      } else if (days <= 3) {
        actions.push({
          action: 'trim',
          rationale: `Earnings in ${days} days - consider reducing position size before announcement`,
          priority: 'medium',
          symbols: [earningsConfig.symbol],
        });
      } else {
        actions.push({
          action: 'monitor',
          rationale: `Earnings in ${days} days - plan exit strategy`,
          priority: 'low',
          symbols: [earningsConfig.symbol],
        });
      }
      break;
    }

    case 'bid_ask_widening': {
      const spreadPercent = context.spreadPercent ?? 0;

      if (spreadPercent >= 20) {
        actions.push({
          action: 'hold',
          rationale: `Very wide spread (${spreadPercent.toFixed(1)}%) - avoid trading until liquidity improves`,
          priority: 'high',
          symbols: context.position ? [context.position.symbol] : [],
        });
      } else {
        actions.push({
          action: 'monitor',
          rationale: `Spread has widened to ${spreadPercent.toFixed(1)}% - be patient with limit orders`,
          priority: 'medium',
          symbols: context.position ? [context.position.symbol] : [],
        });
      }
      break;
    }

    case 'portfolio_drawdown': {
      const dailyLossPercent = Math.abs(
        context.portfolio?.dailyPnLPercent ?? 0
      );

      if (dailyLossPercent >= 10) {
        actions.push({
          action: 'exit',
          rationale: `Severe drawdown (-${dailyLossPercent.toFixed(1)}%) - consider reducing all positions`,
          priority: 'high',
          symbols: [],
        });
      } else if (dailyLossPercent >= 5) {
        actions.push({
          action: 'trim',
          rationale: `Significant drawdown (-${dailyLossPercent.toFixed(1)}%) - reduce exposure`,
          priority: 'high',
          symbols: [],
        });
        actions.push({
          action: 'hedge',
          rationale: 'Consider hedging remaining positions',
          priority: 'medium',
          symbols: [],
        });
      }
      break;
    }
  }

  // Add a hold action if no other actions recommended
  if (actions.length === 0) {
    actions.push({
      action: 'hold',
      rationale: 'No immediate action required - continue monitoring',
      priority: 'low',
      symbols: [],
    });
  }

  return actions;
}

/**
 * Generate alert title based on trigger type and context
 */
export function generateAlertTitle(
  triggerType: AlertTriggerType,
  config: AlertTriggerConfig,
  context: AlertContext
): string {
  switch (triggerType) {
    case 'underlying_move': {
      const moveConfig = config as UnderlyingMoveConfig;
      const direction = (context.priceChangePercent ?? 0) > 0 ? '↑' : '↓';
      return `${moveConfig.symbol} ${direction} ${Math.abs(context.priceChangePercent ?? 0).toFixed(1)}%`;
    }
    case 'premium_target': {
      const pnlPercent = context.position?.unrealizedPnLPercent ?? 0;
      const direction = pnlPercent > 0 ? '+' : '';
      return `${context.position?.symbol ?? 'Position'} ${direction}${pnlPercent.toFixed(0)}% P&L`;
    }
    case 'earnings_approaching': {
      const earningsConfig = config as EarningsApproachingConfig;
      return `${earningsConfig.symbol} Earnings in ${context.daysUntilEarnings ?? '?'} days`;
    }
    case 'bid_ask_widening': {
      return `Wide Spread: ${(context.spreadPercent ?? 0).toFixed(1)}%`;
    }
    case 'portfolio_drawdown': {
      return `Portfolio Down ${Math.abs(context.portfolio?.dailyPnLPercent ?? 0).toFixed(1)}%`;
    }
    default:
      return 'Alert';
  }
}

/**
 * Generate detailed alert message
 */
export function generateAlertMessage(
  triggerType: AlertTriggerType,
  config: AlertTriggerConfig,
  context: AlertContext
): string {
  switch (triggerType) {
    case 'underlying_move': {
      const moveConfig = config as UnderlyingMoveConfig;
      return `${moveConfig.symbol} has moved ${Math.abs(context.priceChangePercent ?? 0).toFixed(2)}% ` +
        `from $${(context.previousPrice ?? 0).toFixed(2)} to $${(context.currentPrice ?? 0).toFixed(2)} ` +
        `(change: $${(context.priceChange ?? 0).toFixed(2)}).`;
    }
    case 'premium_target': {
      const pos = context.position;
      if (!pos) return 'Premium target reached.';
      return `${pos.symbol}: ${pos.quantity} contracts, ` +
        `Avg Cost: $${pos.avgCost.toFixed(2)}, ` +
        `Current: $${(pos.currentValue / Math.abs(pos.quantity) / 100).toFixed(2)}, ` +
        `P&L: $${pos.unrealizedPnL.toFixed(2)} (${pos.unrealizedPnLPercent >= 0 ? '+' : ''}${pos.unrealizedPnLPercent.toFixed(1)}%)`;
    }
    case 'earnings_approaching': {
      const earningsConfig = config as EarningsApproachingConfig;
      return `${earningsConfig.symbol} reports earnings ` +
        (context.earningsDate ? `on ${context.earningsDate}` : `in ${context.daysUntilEarnings} days`) +
        `. Review option positions for IV crush risk.`;
    }
    case 'bid_ask_widening': {
      return `Bid-ask spread has widened to ${(context.spreadPercent ?? 0).toFixed(2)}% ` +
        `($${(context.bid ?? 0).toFixed(2)} x $${(context.ask ?? 0).toFixed(2)}). ` +
        `Liquidity may be limited - use caution with market orders.`;
    }
    case 'portfolio_drawdown': {
      const port = context.portfolio;
      if (!port) return 'Portfolio drawdown detected.';
      return `Portfolio value: $${port.totalValue.toFixed(2)}. ` +
        `Daily P&L: $${port.dailyPnL.toFixed(2)} (${port.dailyPnLPercent >= 0 ? '+' : ''}${port.dailyPnLPercent.toFixed(1)}%). ` +
        `Unrealized: $${port.unrealizedPnL.toFixed(2)} (${port.unrealizedPnLPercent >= 0 ? '+' : ''}${port.unrealizedPnLPercent.toFixed(1)}%).`;
    }
    default:
      return 'Alert triggered.';
  }
}

/**
 * Format alert trigger type for display
 */
export function formatAlertTriggerType(type: AlertTriggerType): string {
  switch (type) {
    case 'underlying_move':
      return 'Price Move';
    case 'premium_target':
      return 'Premium Target';
    case 'earnings_approaching':
      return 'Earnings';
    case 'bid_ask_widening':
      return 'Spread Widening';
    case 'portfolio_drawdown':
      return 'Drawdown';
    default:
      return type;
  }
}

/**
 * Format alert severity for display
 */
export function formatAlertSeverity(severity: AlertSeverity): string {
  switch (severity) {
    case 'critical':
      return 'CRITICAL';
    case 'warning':
      return 'Warning';
    case 'info':
      return 'Info';
    default:
      return severity;
  }
}

/**
 * Format alert status for display
 */
export function formatAlertStatus(status: AlertStatus): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'acknowledged':
      return 'Acknowledged';
    case 'dismissed':
      return 'Dismissed';
    case 'resolved':
      return 'Resolved';
    default:
      return status;
  }
}

/**
 * Check if an alert should be visible based on preferences
 */
export function shouldShowAlert(
  event: AlertEvent,
  preferences: AlertPreferences
): boolean {
  if (!preferences.alertsEnabled) return false;

  // Filter by minimum severity
  const severityOrder: AlertSeverity[] = ['info', 'warning', 'critical'];
  const minIndex = severityOrder.indexOf(preferences.minimumSeverity);
  const eventIndex = severityOrder.indexOf(event.severity);
  if (eventIndex < minIndex) return false;

  // Don't show dismissed alerts
  if (event.status === 'dismissed') return false;

  // Auto-dismiss resolved alerts if configured
  if (event.status === 'resolved' && preferences.autoDismissResolved) {
    return false;
  }

  return true;
}

/**
 * Validate an alert trigger configuration
 */
export function validateAlertTrigger(config: unknown): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const result = AlertTriggerConfigSchema.safeParse(config);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(
        (e) => `${e.path.join('.')}: ${e.message}`
      ),
      warnings: [],
    };
  }

  const cfg = result.data;

  // Type-specific warnings
  switch (cfg.type) {
    case 'underlying_move':
      if (cfg.movePercent < 2) {
        warnings.push('Very low move threshold may generate many alerts');
      }
      if (cfg.timeWindowMinutes < 60) {
        warnings.push(
          'Short time window may trigger on normal market volatility'
        );
      }
      break;

    case 'premium_target':
      if (!cfg.positionId && !cfg.symbol) {
        errors.push('Either positionId or symbol must be specified');
      }
      if (
        cfg.targetLossPercent !== undefined &&
        cfg.targetLossPercent > cfg.targetProfitPercent
      ) {
        warnings.push(
          'Loss threshold is higher than profit threshold - may not trigger as expected'
        );
      }
      break;

    case 'earnings_approaching':
      if (cfg.daysBeforeEarnings > 30) {
        warnings.push('Very early earnings alert may be less actionable');
      }
      break;

    case 'bid_ask_widening':
      if (!cfg.positionId && !cfg.symbol) {
        errors.push('Either positionId or symbol must be specified');
      }
      if (cfg.spreadThresholdPercent < 2) {
        warnings.push(
          'Low spread threshold may trigger frequently on illiquid options'
        );
      }
      break;

    case 'portfolio_drawdown':
      if (
        !cfg.maxDailyLossAmount &&
        !cfg.maxDailyLossPercent &&
        !cfg.maxUnrealizedLossPercent
      ) {
        errors.push('At least one loss threshold must be specified');
      }
      break;
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Create a default trigger for a given type
 */
export function createDefaultTrigger(
  type: AlertTriggerType,
  symbol?: string,
  preferences?: AlertPreferences
): AlertTriggerConfig {
  const prefs = preferences ?? DEFAULT_ALERT_PREFERENCES;

  switch (type) {
    case 'underlying_move':
      return {
        type: 'underlying_move',
        symbol: symbol ?? 'SPY',
        movePercent: prefs.defaultTriggers.defaultMovePercent,
        direction: 'both',
        timeWindowMinutes: 1440, // 1 day
      };

    case 'premium_target':
      return {
        type: 'premium_target',
        symbol: symbol,
        targetProfitPercent: prefs.defaultTriggers.defaultPremiumTargetPercent,
        targetLossPercent: -50,
      };

    case 'earnings_approaching':
      return {
        type: 'earnings_approaching',
        symbol: symbol ?? 'AAPL',
        daysBeforeEarnings: prefs.defaultTriggers.defaultDaysBeforeEarnings,
      };

    case 'bid_ask_widening':
      return {
        type: 'bid_ask_widening',
        symbol: symbol,
        spreadThresholdPercent:
          prefs.defaultTriggers.defaultSpreadThresholdPercent,
      };

    case 'portfolio_drawdown':
      return {
        type: 'portfolio_drawdown',
        maxDailyLossPercent: prefs.defaultTriggers.defaultMaxDailyLossPercent,
      };

    default:
      throw new Error(`Unknown trigger type: ${type}`);
  }
}

/**
 * Current schema version for stored alerts
 */
export const ALERTS_SCHEMA_VERSION = 1;
