/**
 * Audit Log Types
 *
 * Defines types and schemas for the compliance audit trail system.
 * Every recommendation, approval, execution, rejection, and cancellation
 * is logged for compliance and review purposes.
 */

import { z } from 'zod';

// ============================================================================
// Event Types
// ============================================================================

/**
 * Types of events that can be logged in the audit trail
 */
export type AuditEventType =
  | 'recommendation'  // LLM agent generated a trade recommendation
  | 'approval'        // User approved a trade proposal
  | 'rejection'       // User rejected a trade proposal
  | 'execution'       // Order was submitted to broker
  | 'cancellation'    // Order was canceled
  | 'modification'    // Order was modified
  | 'fill'            // Order was filled (partially or fully)
  | 'risk_check'      // Risk validation was performed
  | 'config_change'   // Risk config or settings changed
  | 'connection'      // Broker connection event
  | 'error';          // System error event

/**
 * Who or what initiated the action
 */
export type AuditActor =
  | 'user'            // Human user initiated
  | 'agent'           // LLM agent initiated
  | 'system'          // System/automated process
  | 'broker';         // Broker-initiated (e.g., fill notification)

/**
 * Tag indicating whether action was human or agent initiated
 */
export type InitiatorTag = 'human_initiated' | 'agent_initiated' | 'system_initiated';

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * A single audit log entry
 */
export interface AuditLogEntry {
  /** Unique ID for this log entry (UUID) */
  id: string;
  /** Timestamp of the event (ISO 8601) */
  timestamp: string;
  /** Type of event */
  eventType: AuditEventType;
  /** Who/what initiated the action */
  actor: AuditActor;
  /** Account this event is associated with */
  accountId: string;
  /** Trade proposal ID if applicable */
  proposalId?: string;
  /** Broker order ID if applicable */
  orderId?: string;
  /** Correlation ID linking related events (e.g., multi-leg orders) */
  correlationId?: string;
  /** Human or agent initiated tag */
  initiatorTag: InitiatorTag;
  /** Event-specific details (JSON-serializable) */
  details: AuditEventDetails;
  /** Data sources used (for recommendations) */
  dataSources?: AuditDataSource[];
  /** Human-readable summary of the event */
  summary: string;
}

/**
 * Data source reference for audit trail
 */
export interface AuditDataSource {
  /** Type of data source */
  sourceType: 'portfolio_snapshot' | 'option_chain' | 'technical_indicators' | 'market_data' | 'risk_config' | 'user_input' | 'broker_api' | 'other';
  /** Description of the data */
  description: string;
  /** When the data was retrieved */
  retrievedAt: string;
  /** Optional reference (e.g., symbol, endpoint) */
  reference?: string;
}

/**
 * Event-specific details union type
 */
export type AuditEventDetails =
  | RecommendationDetails
  | ApprovalDetails
  | RejectionDetails
  | ExecutionDetails
  | CancellationDetails
  | ModificationDetails
  | FillDetails
  | RiskCheckDetails
  | ConfigChangeDetails
  | ConnectionDetails
  | ErrorDetails;

/**
 * Details for recommendation events
 */
export interface RecommendationDetails {
  type: 'recommendation';
  /** Strategy type (e.g., 'long_call', 'vertical_spread') */
  strategyType: string;
  /** Underlying symbol */
  underlying: string;
  /** Confidence level */
  confidence: 'low' | 'medium' | 'high';
  /** Thesis points */
  thesis: string[];
  /** Catalysts identified */
  catalysts: string[];
  /** Number of contracts/legs */
  contractCount: number;
  /** Estimated max loss */
  estimatedMaxLoss?: number;
  /** Estimated max loss as percent of account */
  estimatedMaxLossPercent?: number;
}

/**
 * Details for approval events
 */
export interface ApprovalDetails {
  type: 'approval';
  /** Strategy being approved */
  strategyType: string;
  /** Underlying symbol */
  underlying: string;
  /** Number of orders to be placed */
  orderCount: number;
  /** Total estimated cost (positive = debit, negative = credit) */
  estimatedCost: number;
  /** Risk check results at time of approval */
  riskChecksPassed: boolean;
  /** Any warnings at time of approval */
  warnings?: string[];
}

/**
 * Details for rejection events
 */
export interface RejectionDetails {
  type: 'rejection';
  /** Strategy being rejected */
  strategyType: string;
  /** Underlying symbol */
  underlying: string;
  /** Reason for rejection */
  reason?: string;
  /** Who rejected (user or system) */
  rejectedBy: 'user' | 'system';
  /** If system rejected, which checks failed */
  failedChecks?: string[];
}

/**
 * Details for execution events
 */
export interface ExecutionDetails {
  type: 'execution';
  /** Symbol being traded */
  symbol: string;
  /** Underlying for options */
  underlying?: string;
  /** Buy or sell */
  side: 'buy' | 'sell';
  /** Quantity */
  quantity: number;
  /** Order type */
  orderType: string;
  /** Limit price if applicable */
  limitPrice?: number;
  /** Idempotency key used */
  idempotencyKey: string;
  /** Broker order ID if successful */
  brokerOrderId?: string;
  /** Whether submission succeeded */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
  /** Error code if failed */
  errorCode?: string;
}

/**
 * Details for cancellation events
 */
export interface CancellationDetails {
  type: 'cancellation';
  /** Symbol of canceled order */
  symbol: string;
  /** Broker order ID */
  brokerOrderId: string;
  /** Reason for cancellation */
  reason?: string;
  /** Whether cancellation succeeded */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Details for modification events
 */
export interface ModificationDetails {
  type: 'modification';
  /** Symbol being modified */
  symbol: string;
  /** Broker order ID */
  brokerOrderId: string;
  /** What was modified */
  modificationType: 'price' | 'quantity' | 'other';
  /** Previous value */
  previousValue: string | number;
  /** New value */
  newValue: string | number;
  /** Whether modification succeeded */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Details for fill events
 */
export interface FillDetails {
  type: 'fill';
  /** Symbol filled */
  symbol: string;
  /** Broker order ID */
  brokerOrderId: string;
  /** Quantity filled */
  filledQuantity: number;
  /** Total quantity on order */
  totalQuantity: number;
  /** Fill price */
  fillPrice: number;
  /** Whether fully filled */
  isComplete: boolean;
  /** Commission if available */
  commission?: number;
}

/**
 * Details for risk check events
 */
export interface RiskCheckDetails {
  type: 'risk_check';
  /** What triggered the risk check */
  trigger: 'pre_trade' | 'position_update' | 'scheduled' | 'manual';
  /** Symbol being checked (if applicable) */
  symbol?: string;
  /** Whether all checks passed */
  passed: boolean;
  /** Individual check results */
  checks: Array<{
    checkType: string;
    passed: boolean;
    actualValue?: number | string;
    limit?: number | string;
    message: string;
  }>;
  /** Total checks run */
  totalChecks: number;
  /** Number of checks that passed */
  passedChecks: number;
}

/**
 * Details for config change events
 */
export interface ConfigChangeDetails {
  type: 'config_change';
  /** What config was changed */
  configType: 'risk_config' | 'auto_reprice' | 'alerts' | 'other';
  /** Field that was changed */
  field: string;
  /** Previous value (masked if sensitive) */
  previousValue?: string | number | boolean;
  /** New value (masked if sensitive) */
  newValue: string | number | boolean;
  /** Config ID if applicable */
  configId?: string;
}

/**
 * Details for connection events
 */
export interface ConnectionDetails {
  type: 'connection';
  /** Connection action */
  action: 'connect' | 'disconnect' | 'reconnect' | 'validate';
  /** Broker type */
  brokerType: string;
  /** Whether action succeeded */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Details for error events
 */
export interface ErrorDetails {
  type: 'error';
  /** Error category */
  category: 'broker' | 'validation' | 'system' | 'network' | 'unknown';
  /** Error code if available */
  errorCode?: string;
  /** Error message */
  errorMessage: string;
  /** Operation that failed */
  operation: string;
  /** Whether the error was recoverable */
  recoverable: boolean;
  /** Stack trace (sanitized, no secrets) */
  stackTrace?: string;
}

// ============================================================================
// Stored Entry
// ============================================================================

/**
 * User note attached to an audit log entry
 */
export interface AuditEntryNote {
  /** Unique ID for this note */
  id: string;
  /** The note text */
  text: string;
  /** When the note was added */
  addedAt: string;
  /** When the note was last updated */
  updatedAt?: string;
}

/**
 * Stored audit log entry with metadata
 */
export interface StoredAuditLogEntry extends AuditLogEntry {
  /** When this entry was created in storage */
  createdAt: string;
  /** Version number for schema migrations */
  version: number;
  /** User-added notes for journal review */
  notes?: AuditEntryNote[];
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Schema for audit data source
 */
export const AuditDataSourceSchema = z.object({
  sourceType: z.enum([
    'portfolio_snapshot',
    'option_chain',
    'technical_indicators',
    'market_data',
    'risk_config',
    'user_input',
    'broker_api',
    'other',
  ]),
  description: z.string().min(1),
  retrievedAt: z.string().datetime(),
  reference: z.string().optional(),
});

/**
 * Base schema for all event details
 */
const BaseEventDetailsSchema = z.object({
  type: z.string(),
});

/**
 * Schema for recommendation details
 */
export const RecommendationDetailsSchema = z.object({
  type: z.literal('recommendation'),
  strategyType: z.string().min(1),
  underlying: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  thesis: z.array(z.string()),
  catalysts: z.array(z.string()),
  contractCount: z.number().int().positive(),
  estimatedMaxLoss: z.number().optional(),
  estimatedMaxLossPercent: z.number().optional(),
});

/**
 * Schema for approval details
 */
export const ApprovalDetailsSchema = z.object({
  type: z.literal('approval'),
  strategyType: z.string().min(1),
  underlying: z.string().min(1),
  orderCount: z.number().int().positive(),
  estimatedCost: z.number(),
  riskChecksPassed: z.boolean(),
  warnings: z.array(z.string()).optional(),
});

/**
 * Schema for rejection details
 */
export const RejectionDetailsSchema = z.object({
  type: z.literal('rejection'),
  strategyType: z.string().min(1),
  underlying: z.string().min(1),
  reason: z.string().optional(),
  rejectedBy: z.enum(['user', 'system']),
  failedChecks: z.array(z.string()).optional(),
});

/**
 * Schema for execution details
 */
export const ExecutionDetailsSchema = z.object({
  type: z.literal('execution'),
  symbol: z.string().min(1),
  underlying: z.string().optional(),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  orderType: z.string().min(1),
  limitPrice: z.number().optional(),
  idempotencyKey: z.string().uuid(),
  brokerOrderId: z.string().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
});

/**
 * Schema for cancellation details
 */
export const CancellationDetailsSchema = z.object({
  type: z.literal('cancellation'),
  symbol: z.string().min(1),
  brokerOrderId: z.string().min(1),
  reason: z.string().optional(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

/**
 * Schema for modification details
 */
export const ModificationDetailsSchema = z.object({
  type: z.literal('modification'),
  symbol: z.string().min(1),
  brokerOrderId: z.string().min(1),
  modificationType: z.enum(['price', 'quantity', 'other']),
  previousValue: z.union([z.string(), z.number()]),
  newValue: z.union([z.string(), z.number()]),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

/**
 * Schema for fill details
 */
export const FillDetailsSchema = z.object({
  type: z.literal('fill'),
  symbol: z.string().min(1),
  brokerOrderId: z.string().min(1),
  filledQuantity: z.number().positive(),
  totalQuantity: z.number().positive(),
  fillPrice: z.number().positive(),
  isComplete: z.boolean(),
  commission: z.number().optional(),
});

/**
 * Schema for risk check details
 */
export const RiskCheckDetailsSchema = z.object({
  type: z.literal('risk_check'),
  trigger: z.enum(['pre_trade', 'position_update', 'scheduled', 'manual']),
  symbol: z.string().optional(),
  passed: z.boolean(),
  checks: z.array(
    z.object({
      checkType: z.string(),
      passed: z.boolean(),
      actualValue: z.union([z.number(), z.string()]).optional(),
      limit: z.union([z.number(), z.string()]).optional(),
      message: z.string(),
    })
  ),
  totalChecks: z.number().int().min(0),
  passedChecks: z.number().int().min(0),
});

/**
 * Schema for config change details
 */
export const ConfigChangeDetailsSchema = z.object({
  type: z.literal('config_change'),
  configType: z.enum(['risk_config', 'auto_reprice', 'alerts', 'other']),
  field: z.string().min(1),
  previousValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  newValue: z.union([z.string(), z.number(), z.boolean()]),
  configId: z.string().optional(),
});

/**
 * Schema for connection details
 */
export const ConnectionDetailsSchema = z.object({
  type: z.literal('connection'),
  action: z.enum(['connect', 'disconnect', 'reconnect', 'validate']),
  brokerType: z.string().min(1),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

/**
 * Schema for error details
 */
export const ErrorDetailsSchema = z.object({
  type: z.literal('error'),
  category: z.enum(['broker', 'validation', 'system', 'network', 'unknown']),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  operation: z.string().min(1),
  recoverable: z.boolean(),
  stackTrace: z.string().optional(),
});

/**
 * Union schema for all event details
 */
export const AuditEventDetailsSchema = z.discriminatedUnion('type', [
  RecommendationDetailsSchema,
  ApprovalDetailsSchema,
  RejectionDetailsSchema,
  ExecutionDetailsSchema,
  CancellationDetailsSchema,
  ModificationDetailsSchema,
  FillDetailsSchema,
  RiskCheckDetailsSchema,
  ConfigChangeDetailsSchema,
  ConnectionDetailsSchema,
  ErrorDetailsSchema,
]);

/**
 * Schema for audit log entry
 */
export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  eventType: z.enum([
    'recommendation',
    'approval',
    'rejection',
    'execution',
    'cancellation',
    'modification',
    'fill',
    'risk_check',
    'config_change',
    'connection',
    'error',
  ]),
  actor: z.enum(['user', 'agent', 'system', 'broker']),
  accountId: z.string().min(1),
  proposalId: z.string().uuid().optional(),
  orderId: z.string().optional(),
  correlationId: z.string().uuid().optional(),
  initiatorTag: z.enum(['human_initiated', 'agent_initiated', 'system_initiated']),
  details: AuditEventDetailsSchema,
  dataSources: z.array(AuditDataSourceSchema).optional(),
  summary: z.string().min(1),
});

/**
 * Schema for audit entry note
 */
export const AuditEntryNoteSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1),
  addedAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

/**
 * Schema for stored audit log entry
 */
export const StoredAuditLogEntrySchema = AuditLogEntrySchema.extend({
  createdAt: z.string().datetime(),
  version: z.number().int().positive(),
  notes: z.array(AuditEntryNoteSchema).optional(),
});

// ============================================================================
// Query Types
// ============================================================================

/**
 * Options for querying audit logs
 */
export interface AuditLogQueryOptions {
  /** Filter by event types */
  eventTypes?: AuditEventType[];
  /** Filter by actor */
  actor?: AuditActor;
  /** Filter by initiator tag */
  initiatorTag?: InitiatorTag;
  /** Filter by proposal ID */
  proposalId?: string;
  /** Filter by order ID */
  orderId?: string;
  /** Filter by correlation ID */
  correlationId?: string;
  /** Filter events after this timestamp */
  startDate?: string;
  /** Filter events before this timestamp */
  endDate?: string;
  /** Maximum number of entries to return */
  limit?: number;
  /** Number of entries to skip */
  offset?: number;
  /** Sort order (default: newest first) */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Result of an audit log query
 */
export interface AuditLogQueryResult {
  /** Matching entries */
  entries: StoredAuditLogEntry[];
  /** Total count matching filters (before pagination) */
  totalCount: number;
  /** Whether there are more entries */
  hasMore: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the initiator tag based on actor
 */
export function getInitiatorTag(actor: AuditActor): InitiatorTag {
  switch (actor) {
    case 'user':
      return 'human_initiated';
    case 'agent':
      return 'agent_initiated';
    case 'system':
    case 'broker':
      return 'system_initiated';
    default:
      return 'system_initiated';
  }
}

/**
 * Format event type for display
 */
export function formatEventType(eventType: AuditEventType): string {
  const formats: Record<AuditEventType, string> = {
    recommendation: 'Recommendation',
    approval: 'Approval',
    rejection: 'Rejection',
    execution: 'Execution',
    cancellation: 'Cancellation',
    modification: 'Modification',
    fill: 'Fill',
    risk_check: 'Risk Check',
    config_change: 'Config Change',
    connection: 'Connection',
    error: 'Error',
  };
  return formats[eventType] || eventType;
}

/**
 * Format actor for display
 */
export function formatActor(actor: AuditActor): string {
  const formats: Record<AuditActor, string> = {
    user: 'User',
    agent: 'AI Agent',
    system: 'System',
    broker: 'Broker',
  };
  return formats[actor] || actor;
}

/**
 * Generate a summary for an audit event
 */
export function generateEventSummary(
  eventType: AuditEventType,
  actor: AuditActor,
  details: AuditEventDetails
): string {
  const actorStr = formatActor(actor);

  switch (details.type) {
    case 'recommendation':
      return `${actorStr} recommended ${details.strategyType} on ${details.underlying} (${details.confidence} confidence)`;

    case 'approval':
      return `${actorStr} approved ${details.strategyType} on ${details.underlying} (${details.orderCount} orders)`;

    case 'rejection':
      return `${actorStr} rejected ${details.strategyType} on ${details.underlying}${details.reason ? `: ${details.reason}` : ''}`;

    case 'execution':
      return `${actorStr} ${details.success ? 'submitted' : 'failed to submit'} ${details.side.toUpperCase()} ${details.quantity}x ${details.symbol}${details.brokerOrderId ? ` (Order #${details.brokerOrderId})` : ''}`;

    case 'cancellation':
      return `${actorStr} ${details.success ? 'canceled' : 'failed to cancel'} order #${details.brokerOrderId} on ${details.symbol}`;

    case 'modification':
      return `${actorStr} ${details.success ? 'modified' : 'failed to modify'} ${details.modificationType} on order #${details.brokerOrderId}`;

    case 'fill':
      return `Order #${details.brokerOrderId} ${details.isComplete ? 'filled' : 'partially filled'}: ${details.filledQuantity}/${details.totalQuantity} @ $${details.fillPrice.toFixed(2)}`;

    case 'risk_check':
      return `${actorStr} risk check ${details.passed ? 'passed' : 'failed'} (${details.passedChecks}/${details.totalChecks} checks)${details.symbol ? ` for ${details.symbol}` : ''}`;

    case 'config_change':
      return `${actorStr} changed ${details.configType} setting: ${details.field}`;

    case 'connection':
      return `${actorStr} ${details.action} to ${details.brokerType} ${details.success ? 'succeeded' : 'failed'}`;

    case 'error':
      return `${details.category} error during ${details.operation}: ${details.errorMessage}`;

    default:
      return `${actorStr} ${formatEventType(eventType).toLowerCase()}`;
  }
}

/**
 * Validate an audit log entry
 */
export function validateAuditLogEntry(entry: unknown): {
  valid: boolean;
  errors: string[];
} {
  const result = AuditLogEntrySchema.safeParse(entry);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(
        (e) => `${e.path.join('.')}: ${e.message}`
      ),
    };
  }
  return { valid: true, errors: [] };
}

/**
 * Current schema version
 */
export const AUDIT_LOG_SCHEMA_VERSION = 1;
