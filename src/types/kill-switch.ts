/**
 * Kill Switch Types
 *
 * Defines types and schemas for the emergency kill switch system.
 * The kill switch allows users to immediately stop all automation
 * and optionally cancel all open orders when something goes wrong.
 */

import { z } from 'zod';

// ============================================================================
// Constants
// ============================================================================

/**
 * Schema version for kill switch data
 */
export const KILL_SWITCH_SCHEMA_VERSION = 1;

// ============================================================================
// Core Types
// ============================================================================

/**
 * Kill switch state
 */
export type KillSwitchState = 'active' | 'inactive';

/**
 * Who activated the kill switch
 */
export type KillSwitchActivator = 'user' | 'system' | 'automated';

/**
 * Reason category for kill switch activation
 */
export type KillSwitchReasonCategory =
  | 'manual'           // User manually triggered
  | 'risk_limit'       // Risk limit exceeded
  | 'error_cascade'    // Multiple errors detected
  | 'market_conditions' // Unusual market conditions
  | 'connection_issues' // Broker connection problems
  | 'other';           // Other reasons

/**
 * Configuration for kill switch behavior
 */
export interface KillSwitchConfig {
  /** Whether to cancel all open orders when kill switch is activated (default: false) */
  cancelOrdersOnActivation: boolean;
  /** Whether to disable auto-reprice when kill switch is activated (default: true) */
  disableAutoRepriceOnActivation: boolean;
  /** Whether to disable alert monitoring when kill switch is activated (default: true) */
  disableAlertsOnActivation: boolean;
  /** Cooldown period (in seconds) before kill switch can be re-enabled (default: 30) */
  reEnableCooldownSeconds: number;
  /** Whether to require confirmation for re-enable (default: true) */
  requireConfirmationForReEnable: boolean;
}

/**
 * Default kill switch configuration
 */
export const DEFAULT_KILL_SWITCH_CONFIG: KillSwitchConfig = {
  cancelOrdersOnActivation: false, // User must explicitly opt-in
  disableAutoRepriceOnActivation: true,
  disableAlertsOnActivation: true,
  reEnableCooldownSeconds: 30,
  requireConfirmationForReEnable: true,
};

/**
 * Status of the kill switch
 */
export interface KillSwitchStatus {
  /** Current state of the kill switch */
  state: KillSwitchState;
  /** Whether the system is in read-only mode */
  readOnlyMode: boolean;
  /** When the kill switch was activated (if active) */
  activatedAt?: string;
  /** Who activated the kill switch */
  activatedBy?: KillSwitchActivator;
  /** Reason for activation */
  reason?: string;
  /** Reason category */
  reasonCategory?: KillSwitchReasonCategory;
  /** Number of orders cancelled when activated */
  ordersCancelled?: number;
  /** IDs of cancelled orders */
  cancelledOrderIds?: string[];
  /** Automation features that were disabled */
  disabledFeatures?: string[];
  /** When the kill switch can be re-enabled (cooldown end time) */
  canReEnableAt?: string;
  /** Configuration used */
  config: KillSwitchConfig;
}

/**
 * Result of activating the kill switch
 */
export interface KillSwitchActivationResult {
  /** Whether activation was successful */
  success: boolean;
  /** New status after activation */
  status: KillSwitchStatus;
  /** Orders that were cancelled (if cancelOrdersOnActivation was true) */
  ordersCancelled: Array<{
    orderId: string;
    symbol: string;
    side: string;
    quantity: number;
    success: boolean;
    error?: string;
  }>;
  /** Features that were disabled */
  featuresDisabled: string[];
  /** Error message if activation failed */
  error?: string;
  /** Timestamp of activation */
  activatedAt: string;
}

/**
 * Result of deactivating the kill switch
 */
export interface KillSwitchDeactivationResult {
  /** Whether deactivation was successful */
  success: boolean;
  /** New status after deactivation */
  status: KillSwitchStatus;
  /** Features that were re-enabled */
  featuresReEnabled: string[];
  /** Error message if deactivation failed */
  error?: string;
  /** Timestamp of deactivation */
  deactivatedAt: string;
}

/**
 * Event logged when kill switch state changes
 */
export interface KillSwitchEvent {
  /** Unique event ID */
  id: string;
  /** Timestamp of the event */
  timestamp: string;
  /** Type of event */
  action: 'activated' | 'deactivated' | 'config_changed';
  /** Who triggered the event */
  triggeredBy: KillSwitchActivator;
  /** Reason provided */
  reason?: string;
  /** Reason category */
  reasonCategory?: KillSwitchReasonCategory;
  /** Orders cancelled (for activation events) */
  ordersCancelled?: number;
  /** Features affected */
  featuresAffected?: string[];
  /** Previous state */
  previousState: KillSwitchState;
  /** New state */
  newState: KillSwitchState;
}

/**
 * Stored kill switch state (for persistence)
 */
export interface StoredKillSwitchState {
  /** Schema version */
  version: number;
  /** Account ID */
  accountId: string;
  /** Current status */
  status: KillSwitchStatus;
  /** Event history (limited to recent events) */
  recentEvents: KillSwitchEvent[];
  /** Configuration */
  config: KillSwitchConfig;
  /** Last updated timestamp */
  updatedAt: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Schema for kill switch configuration
 */
export const KillSwitchConfigSchema = z.object({
  cancelOrdersOnActivation: z.boolean().default(false),
  disableAutoRepriceOnActivation: z.boolean().default(true),
  disableAlertsOnActivation: z.boolean().default(true),
  reEnableCooldownSeconds: z.number().int().min(0).max(3600).default(30),
  requireConfirmationForReEnable: z.boolean().default(true),
});

/**
 * Schema for kill switch status
 */
export const KillSwitchStatusSchema = z.object({
  state: z.enum(['active', 'inactive']),
  readOnlyMode: z.boolean(),
  activatedAt: z.string().datetime().optional(),
  activatedBy: z.enum(['user', 'system', 'automated']).optional(),
  reason: z.string().optional(),
  reasonCategory: z.enum([
    'manual',
    'risk_limit',
    'error_cascade',
    'market_conditions',
    'connection_issues',
    'other',
  ]).optional(),
  ordersCancelled: z.number().int().min(0).optional(),
  cancelledOrderIds: z.array(z.string()).optional(),
  disabledFeatures: z.array(z.string()).optional(),
  canReEnableAt: z.string().datetime().optional(),
  config: KillSwitchConfigSchema,
});

/**
 * Schema for kill switch event
 */
export const KillSwitchEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  action: z.enum(['activated', 'deactivated', 'config_changed']),
  triggeredBy: z.enum(['user', 'system', 'automated']),
  reason: z.string().optional(),
  reasonCategory: z.enum([
    'manual',
    'risk_limit',
    'error_cascade',
    'market_conditions',
    'connection_issues',
    'other',
  ]).optional(),
  ordersCancelled: z.number().int().min(0).optional(),
  featuresAffected: z.array(z.string()).optional(),
  previousState: z.enum(['active', 'inactive']),
  newState: z.enum(['active', 'inactive']),
});

/**
 * Schema for stored kill switch state
 */
export const StoredKillSwitchStateSchema = z.object({
  version: z.number().int().positive(),
  accountId: z.string().min(1),
  status: KillSwitchStatusSchema,
  recentEvents: z.array(KillSwitchEventSchema).max(100),
  config: KillSwitchConfigSchema,
  updatedAt: z.string().datetime(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if the kill switch is currently active
 */
export function isKillSwitchActive(status: KillSwitchStatus): boolean {
  return status.state === 'active';
}

/**
 * Check if the system is in read-only mode
 */
export function isReadOnlyMode(status: KillSwitchStatus): boolean {
  return status.readOnlyMode;
}

/**
 * Check if the kill switch can be re-enabled (cooldown has passed)
 */
export function canReEnable(status: KillSwitchStatus): boolean {
  if (status.state !== 'active') {
    return false;
  }

  if (!status.canReEnableAt) {
    return true;
  }

  return new Date() >= new Date(status.canReEnableAt);
}

/**
 * Get remaining cooldown time in seconds
 */
export function getRemainingCooldownSeconds(status: KillSwitchStatus): number {
  if (status.state !== 'active' || !status.canReEnableAt) {
    return 0;
  }

  const remaining = new Date(status.canReEnableAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

/**
 * Format kill switch state for display
 */
export function formatKillSwitchState(state: KillSwitchState): string {
  return state === 'active' ? 'ACTIVE' : 'Inactive';
}

/**
 * Format reason category for display
 */
export function formatReasonCategory(category: KillSwitchReasonCategory): string {
  const labels: Record<KillSwitchReasonCategory, string> = {
    manual: 'Manual Activation',
    risk_limit: 'Risk Limit Exceeded',
    error_cascade: 'Multiple Errors Detected',
    market_conditions: 'Market Conditions',
    connection_issues: 'Connection Issues',
    other: 'Other',
  };
  return labels[category];
}

/**
 * Create the initial inactive kill switch status
 */
export function createInactiveStatus(config: KillSwitchConfig = DEFAULT_KILL_SWITCH_CONFIG): KillSwitchStatus {
  return {
    state: 'inactive',
    readOnlyMode: false,
    config,
  };
}

/**
 * Generate summary message for kill switch status
 */
export function generateStatusSummary(status: KillSwitchStatus): string {
  if (status.state === 'inactive') {
    return 'Kill switch is inactive. System operating normally.';
  }

  const parts: string[] = ['⛔ KILL SWITCH ACTIVE - System in read-only mode'];

  if (status.reason) {
    parts.push(`Reason: ${status.reason}`);
  }

  if (status.activatedAt) {
    const activatedDate = new Date(status.activatedAt);
    parts.push(`Activated: ${activatedDate.toLocaleString()}`);
  }

  if (status.ordersCancelled !== undefined && status.ordersCancelled > 0) {
    parts.push(`Orders cancelled: ${status.ordersCancelled}`);
  }

  if (status.disabledFeatures && status.disabledFeatures.length > 0) {
    parts.push(`Disabled: ${status.disabledFeatures.join(', ')}`);
  }

  const cooldownRemaining = getRemainingCooldownSeconds(status);
  if (cooldownRemaining > 0) {
    parts.push(`Re-enable available in: ${cooldownRemaining}s`);
  }

  return parts.join(' | ');
}

/**
 * Validate kill switch configuration
 */
export function validateKillSwitchConfig(config: Partial<KillSwitchConfig>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check cooldown is reasonable
  if (config.reEnableCooldownSeconds !== undefined) {
    if (config.reEnableCooldownSeconds < 0) {
      errors.push('Cooldown period cannot be negative');
    }
    if (config.reEnableCooldownSeconds > 3600) {
      errors.push('Cooldown period cannot exceed 1 hour (3600 seconds)');
    }
    if (config.reEnableCooldownSeconds < 10) {
      warnings.push('Very short cooldown period - consider increasing to prevent accidental re-enable');
    }
  }

  // Warn about aggressive settings
  if (config.cancelOrdersOnActivation === true) {
    warnings.push('cancelOrdersOnActivation is enabled - all open orders will be cancelled on activation');
  }

  if (config.requireConfirmationForReEnable === false) {
    warnings.push('Confirmation disabled for re-enable - system can be quickly re-enabled');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
