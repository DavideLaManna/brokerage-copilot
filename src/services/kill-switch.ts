/**
 * Kill Switch Service
 *
 * Provides emergency stop functionality for the trading copilot.
 * When activated, the kill switch:
 * - Puts the system into read-only mode (no order submission)
 * - Optionally cancels all open orders
 * - Disables all automation (auto-reprice, alert monitoring)
 * - Logs the event to the audit trail
 *
 * Re-enabling requires:
 * - Cooldown period to pass
 * - User confirmation (if configured)
 */

import { randomUUID } from 'crypto';
import type { BrokerAdapter, Order } from '../types/broker.js';
import type { AuditLogService } from './audit-log.js';
import {
  DEFAULT_KILL_SWITCH_CONFIG,
  KILL_SWITCH_SCHEMA_VERSION,
  createInactiveStatus,
  canReEnable,
  getRemainingCooldownSeconds,
  type KillSwitchConfig,
  type KillSwitchStatus,
  type KillSwitchActivationResult,
  type KillSwitchDeactivationResult,
  type KillSwitchEvent,
  type KillSwitchActivator,
  type KillSwitchReasonCategory,
  type StoredKillSwitchState,
} from '../types/kill-switch.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Logger interface for the kill switch service
 */
export interface KillSwitchServiceLogger {
  debug?: (message: string, data?: unknown) => void;
  info?: (message: string, data?: unknown) => void;
  warn?: (message: string, data?: unknown) => void;
  error?: (message: string, data?: unknown) => void;
}

/**
 * Configuration for the kill switch service
 */
export interface KillSwitchServiceConfig {
  /** Kill switch behavior configuration */
  killSwitchConfig?: Partial<KillSwitchConfig>;
  /** Logger for debug output */
  logger?: KillSwitchServiceLogger;
  /** Maximum events to keep in history */
  maxEventHistory?: number;
}

/**
 * Callback for notifying other services when kill switch state changes
 */
export type KillSwitchCallback = (status: KillSwitchStatus) => void | Promise<void>;

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Kill Switch Service
 *
 * Manages the emergency kill switch functionality.
 */
export class KillSwitchService {
  private adapter: BrokerAdapter | null = null;
  private auditLogService?: AuditLogService;
  private accountId: string;
  private config: KillSwitchConfig;
  private logger?: KillSwitchServiceLogger;
  private maxEventHistory: number;

  // Current status
  private status: KillSwitchStatus;

  // Event history
  private events: KillSwitchEvent[] = [];

  // Callbacks for state change notifications
  private callbacks: Set<KillSwitchCallback> = new Set();

  constructor(
    accountId: string,
    config: KillSwitchServiceConfig = {},
    auditLogService?: AuditLogService
  ) {
    this.auditLogService = auditLogService;
    this.accountId = accountId;
    this.config = { ...DEFAULT_KILL_SWITCH_CONFIG, ...config.killSwitchConfig };
    this.logger = config.logger;
    this.maxEventHistory = config.maxEventHistory ?? 100;

    // Initialize with inactive status
    this.status = createInactiveStatus(this.config);
  }

  /**
   * Set the broker adapter (required for order cancellation)
   */
  setAdapter(adapter: BrokerAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Get current kill switch status
   */
  getStatus(): KillSwitchStatus {
    return { ...this.status };
  }

  /**
   * Get event history
   */
  getEventHistory(): KillSwitchEvent[] {
    return [...this.events];
  }

  /**
   * Get current configuration
   */
  getConfig(): KillSwitchConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<KillSwitchConfig>): void {
    const previousConfig = { ...this.config };
    this.config = { ...this.config, ...updates };
    this.status.config = { ...this.config };

    this.logger?.info?.('Kill switch configuration updated', {
      previous: previousConfig,
      new: this.config,
    });

    // Log config change to audit trail
    this.logConfigChange(previousConfig, this.config);
  }

  /**
   * Check if the kill switch is currently active
   */
  isActive(): boolean {
    return this.status.state === 'active';
  }

  /**
   * Check if the system is in read-only mode
   */
  isReadOnly(): boolean {
    return this.status.readOnlyMode;
  }

  /**
   * Register a callback for state changes
   */
  onStateChange(callback: KillSwitchCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Activate the kill switch
   *
   * @param activatedBy - Who is activating (user/system/automated)
   * @param reason - Reason for activation
   * @param reasonCategory - Category of the reason
   * @returns Activation result with details
   */
  async activate(
    activatedBy: KillSwitchActivator = 'user',
    reason?: string,
    reasonCategory: KillSwitchReasonCategory = 'manual'
  ): Promise<KillSwitchActivationResult> {
    const activatedAt = new Date().toISOString();

    this.logger?.warn?.('⛔ KILL SWITCH ACTIVATION REQUESTED', {
      activatedBy,
      reason,
      reasonCategory,
      accountId: this.accountId,
    });

    // If already active, return current status
    if (this.status.state === 'active') {
      this.logger?.info?.('Kill switch is already active');
      return {
        success: true,
        status: this.getStatus(),
        ordersCancelled: [],
        featuresDisabled: this.status.disabledFeatures ?? [],
        activatedAt,
      };
    }

    const previousState = this.status.state;
    const ordersCancelled: KillSwitchActivationResult['ordersCancelled'] = [];
    const featuresDisabled: string[] = [];
    const cancelledOrderIds: string[] = [];

    // Cancel orders if configured
    if (this.config.cancelOrdersOnActivation && this.adapter) {
      try {
        const openOrders = await this.adapter.getOpenOrders();
        this.logger?.info?.(`Cancelling ${openOrders.length} open orders...`);

        for (const order of openOrders) {
          try {
            const success = await this.adapter.cancelOrder(order.id);
            ordersCancelled.push({
              orderId: order.id,
              symbol: order.symbol,
              side: order.side,
              quantity: order.quantity,
              success,
            });
            if (success) {
              cancelledOrderIds.push(order.id);
            }
          } catch (error) {
            ordersCancelled.push({
              orderId: order.id,
              symbol: order.symbol,
              side: order.side,
              quantity: order.quantity,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        this.logger?.info?.(
          `Order cancellation complete: ${cancelledOrderIds.length}/${openOrders.length} cancelled`
        );
      } catch (error) {
        this.logger?.error?.('Failed to fetch open orders for cancellation', { error });
      }
    }

    // Track disabled features
    if (this.config.disableAutoRepriceOnActivation) {
      featuresDisabled.push('auto_reprice');
    }
    if (this.config.disableAlertsOnActivation) {
      featuresDisabled.push('alert_monitoring');
    }

    // Calculate when re-enable is allowed
    const cooldownEndTime = new Date(
      Date.now() + this.config.reEnableCooldownSeconds * 1000
    ).toISOString();

    // Update status
    this.status = {
      state: 'active',
      readOnlyMode: true,
      activatedAt,
      activatedBy,
      reason,
      reasonCategory,
      ordersCancelled: cancelledOrderIds.length,
      cancelledOrderIds,
      disabledFeatures: featuresDisabled,
      canReEnableAt: cooldownEndTime,
      config: this.config,
    };

    // Record event
    const event: KillSwitchEvent = {
      id: randomUUID(),
      timestamp: activatedAt,
      action: 'activated',
      triggeredBy: activatedBy,
      reason,
      reasonCategory,
      ordersCancelled: cancelledOrderIds.length,
      featuresAffected: featuresDisabled,
      previousState,
      newState: 'active',
    };
    this.addEvent(event);

    // Log to audit trail
    await this.logActivation(event, ordersCancelled);

    // Notify callbacks
    await this.notifyCallbacks();

    this.logger?.warn?.('⛔ KILL SWITCH ACTIVATED', {
      status: this.status,
      ordersCancelled: cancelledOrderIds.length,
      featuresDisabled,
    });

    return {
      success: true,
      status: this.getStatus(),
      ordersCancelled,
      featuresDisabled,
      activatedAt,
    };
  }

  /**
   * Deactivate the kill switch (re-enable normal operation)
   *
   * @param confirmedByUser - Whether the user has confirmed re-enable
   * @returns Deactivation result with details
   */
  async deactivate(confirmedByUser: boolean = false): Promise<KillSwitchDeactivationResult> {
    const deactivatedAt = new Date().toISOString();

    this.logger?.info?.('Kill switch deactivation requested', {
      confirmedByUser,
      accountId: this.accountId,
    });

    // If already inactive, return current status
    if (this.status.state === 'inactive') {
      this.logger?.info?.('Kill switch is already inactive');
      return {
        success: true,
        status: this.getStatus(),
        featuresReEnabled: [],
        deactivatedAt,
      };
    }

    // Check cooldown
    if (!canReEnable(this.status)) {
      const remainingSeconds = getRemainingCooldownSeconds(this.status);
      const error = `Cannot re-enable yet. Cooldown remaining: ${remainingSeconds} seconds`;
      this.logger?.warn?.(error);
      return {
        success: false,
        status: this.getStatus(),
        featuresReEnabled: [],
        error,
        deactivatedAt,
      };
    }

    // Check confirmation requirement
    if (this.config.requireConfirmationForReEnable && !confirmedByUser) {
      const error = 'User confirmation required to re-enable the system';
      this.logger?.warn?.(error);
      return {
        success: false,
        status: this.getStatus(),
        featuresReEnabled: [],
        error,
        deactivatedAt,
      };
    }

    const previousState = this.status.state;
    const featuresReEnabled = this.status.disabledFeatures ?? [];

    // Update status
    this.status = createInactiveStatus(this.config);

    // Record event
    const event: KillSwitchEvent = {
      id: randomUUID(),
      timestamp: deactivatedAt,
      action: 'deactivated',
      triggeredBy: 'user',
      featuresAffected: featuresReEnabled,
      previousState,
      newState: 'inactive',
    };
    this.addEvent(event);

    // Log to audit trail
    await this.logDeactivation(event);

    // Notify callbacks
    await this.notifyCallbacks();

    this.logger?.info?.('✅ Kill switch deactivated - system returning to normal operation', {
      featuresReEnabled,
    });

    return {
      success: true,
      status: this.getStatus(),
      featuresReEnabled,
      deactivatedAt,
    };
  }

  /**
   * Get stored state for persistence
   */
  getStoredState(): StoredKillSwitchState {
    return {
      version: KILL_SWITCH_SCHEMA_VERSION,
      accountId: this.accountId,
      status: this.status,
      recentEvents: this.events.slice(-this.maxEventHistory),
      config: this.config,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Restore from stored state
   */
  restoreFromState(state: StoredKillSwitchState): void {
    if (state.version !== KILL_SWITCH_SCHEMA_VERSION) {
      this.logger?.warn?.('Kill switch state version mismatch, using defaults', {
        storedVersion: state.version,
        currentVersion: KILL_SWITCH_SCHEMA_VERSION,
      });
      return;
    }

    if (state.accountId !== this.accountId) {
      this.logger?.warn?.('Kill switch state account mismatch, ignoring', {
        storedAccount: state.accountId,
        currentAccount: this.accountId,
      });
      return;
    }

    this.status = state.status;
    this.events = state.recentEvents;
    this.config = state.config;

    this.logger?.info?.('Kill switch state restored', {
      state: this.status.state,
      eventsRestored: this.events.length,
    });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private addEvent(event: KillSwitchEvent): void {
    this.events.push(event);

    // Trim to max history
    if (this.events.length > this.maxEventHistory) {
      this.events = this.events.slice(-this.maxEventHistory);
    }
  }

  private async notifyCallbacks(): Promise<void> {
    const status = this.getStatus();
    for (const callback of this.callbacks) {
      try {
        await callback(status);
      } catch (error) {
        this.logger?.error?.('Kill switch callback error', { error });
      }
    }
  }

  private async logActivation(
    event: KillSwitchEvent,
    ordersCancelled: KillSwitchActivationResult['ordersCancelled']
  ): Promise<void> {
    if (!this.auditLogService) return;

    try {
      await this.auditLogService.log({
        accountId: this.accountId,
        eventType: 'config_change',
        actor: event.triggeredBy === 'user' ? 'user' : 'system',
        proposalId: undefined,
        orderId: undefined,
        correlationId: event.id,
        details: {
          type: 'config_change',
          configType: 'other',
          field: 'kill_switch',
          previousValue: 'inactive',
          newValue: 'active',
        },
        dataSources: [],
        summary: `⛔ KILL SWITCH ACTIVATED: ${event.reason || 'No reason provided'}. Orders cancelled: ${ordersCancelled.length}. Features disabled: ${event.featuresAffected?.join(', ') || 'none'}.`,
      });
    } catch (error) {
      this.logger?.error?.('Failed to log kill switch activation to audit trail', { error });
    }
  }

  private async logDeactivation(event: KillSwitchEvent): Promise<void> {
    if (!this.auditLogService) return;

    try {
      await this.auditLogService.log({
        accountId: this.accountId,
        eventType: 'config_change',
        actor: 'user',
        proposalId: undefined,
        orderId: undefined,
        correlationId: event.id,
        details: {
          type: 'config_change',
          configType: 'other',
          field: 'kill_switch',
          previousValue: 'active',
          newValue: 'inactive',
        },
        dataSources: [],
        summary: `✅ Kill switch deactivated. Features re-enabled: ${event.featuresAffected?.join(', ') || 'none'}.`,
      });
    } catch (error) {
      this.logger?.error?.('Failed to log kill switch deactivation to audit trail', { error });
    }
  }

  private logConfigChange(
    previous: KillSwitchConfig,
    current: KillSwitchConfig
  ): void {
    if (!this.auditLogService) return;

    // Find what changed
    const changes: string[] = [];
    for (const key of Object.keys(current) as Array<keyof KillSwitchConfig>) {
      if (previous[key] !== current[key]) {
        changes.push(`${key}: ${previous[key]} → ${current[key]}`);
      }
    }

    if (changes.length === 0) return;

    this.auditLogService.log({
      accountId: this.accountId,
      eventType: 'config_change',
      actor: 'user',
      proposalId: undefined,
      orderId: undefined,
      correlationId: randomUUID(),
      details: {
        type: 'config_change',
        configType: 'other',
        field: 'kill_switch_config',
        previousValue: JSON.stringify(previous),
        newValue: JSON.stringify(current),
      },
      dataSources: [],
      summary: `Kill switch config changed: ${changes.join(', ')}`,
    }).catch((error) => {
      this.logger?.error?.('Failed to log config change to audit trail', { error });
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new KillSwitchService instance
 */
export function createKillSwitchService(
  accountId: string,
  config: KillSwitchServiceConfig = {},
  auditLogService?: AuditLogService
): KillSwitchService {
  return new KillSwitchService(accountId, config, auditLogService);
}

// ============================================================================
// Standalone Functions
// ============================================================================

/**
 * Check if an operation should be blocked due to kill switch
 *
 * @param status - Current kill switch status
 * @param operation - Type of operation being attempted
 * @returns true if the operation should be blocked
 */
export function shouldBlockOperation(
  status: KillSwitchStatus,
  operation: 'order_submit' | 'order_modify' | 'auto_reprice' | 'alert_action'
): boolean {
  if (status.state !== 'active') {
    return false;
  }

  // In read-only mode, block all order operations
  if (status.readOnlyMode) {
    if (operation === 'order_submit' || operation === 'order_modify') {
      return true;
    }
  }

  // Check if specific feature is disabled
  if (status.disabledFeatures) {
    if (operation === 'auto_reprice' && status.disabledFeatures.includes('auto_reprice')) {
      return true;
    }
    if (operation === 'alert_action' && status.disabledFeatures.includes('alert_monitoring')) {
      return true;
    }
  }

  return false;
}

/**
 * Get a user-friendly message explaining why an operation was blocked
 */
export function getBlockedOperationMessage(
  status: KillSwitchStatus,
  operation: 'order_submit' | 'order_modify' | 'auto_reprice' | 'alert_action'
): string {
  if (!shouldBlockOperation(status, operation)) {
    return '';
  }

  const operationLabels: Record<typeof operation, string> = {
    order_submit: 'Order submission',
    order_modify: 'Order modification',
    auto_reprice: 'Automatic repricing',
    alert_action: 'Alert-triggered actions',
  };

  let message = `${operationLabels[operation]} blocked: Kill switch is active`;

  if (status.reason) {
    message += ` (${status.reason})`;
  }

  const cooldownRemaining = getRemainingCooldownSeconds(status);
  if (cooldownRemaining > 0) {
    message += `. System can be re-enabled in ${cooldownRemaining} seconds.`;
  }

  return message;
}
