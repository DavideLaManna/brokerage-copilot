/**
 * Types for the Decision Journal component
 */

// ===========================================================================
// Audit Log Types (mirror backend types)
// ===========================================================================

export type AuditEventType =
  | 'recommendation'
  | 'approval'
  | 'rejection'
  | 'execution'
  | 'cancellation'
  | 'modification'
  | 'fill'
  | 'risk_check'
  | 'config_change'
  | 'connection'
  | 'error';

export type AuditActor = 'user' | 'agent' | 'system' | 'broker';

export type InitiatorTag = 'human_initiated' | 'agent_initiated' | 'system_initiated';

export interface AuditEntryNote {
  id: string;
  text: string;
  addedAt: string;
  updatedAt?: string;
}

export interface AuditDataSource {
  sourceType: string;
  description: string;
  retrievedAt: string;
  reference?: string;
}

// Event detail types
export interface RecommendationDetails {
  type: 'recommendation';
  strategyType: string;
  underlying: string;
  confidence: 'low' | 'medium' | 'high';
  thesis: string[];
  catalysts: string[];
  contractCount: number;
  estimatedMaxLoss?: number;
  estimatedMaxLossPercent?: number;
}

export interface ApprovalDetails {
  type: 'approval';
  strategyType: string;
  underlying: string;
  orderCount: number;
  estimatedCost: number;
  riskChecksPassed: boolean;
  warnings?: string[];
}

export interface RejectionDetails {
  type: 'rejection';
  strategyType: string;
  underlying: string;
  reason?: string;
  rejectedBy: 'user' | 'system';
  failedChecks?: string[];
}

export interface ExecutionDetails {
  type: 'execution';
  symbol: string;
  underlying?: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: string;
  limitPrice?: number;
  idempotencyKey: string;
  brokerOrderId?: string;
  success: boolean;
  errorMessage?: string;
  errorCode?: string;
}

export interface CancellationDetails {
  type: 'cancellation';
  symbol: string;
  brokerOrderId: string;
  reason?: string;
  success: boolean;
  errorMessage?: string;
}

export interface FillDetails {
  type: 'fill';
  symbol: string;
  brokerOrderId: string;
  filledQuantity: number;
  totalQuantity: number;
  fillPrice: number;
  isComplete: boolean;
  commission?: number;
}

export interface RiskCheckDetails {
  type: 'risk_check';
  trigger: 'pre_trade' | 'position_update' | 'scheduled' | 'manual';
  symbol?: string;
  passed: boolean;
  checks: Array<{
    checkType: string;
    passed: boolean;
    actualValue?: number | string;
    limit?: number | string;
    message: string;
  }>;
  totalChecks: number;
  passedChecks: number;
}

export interface ConfigChangeDetails {
  type: 'config_change';
  configType: 'risk_config' | 'auto_reprice' | 'alerts' | 'other';
  field: string;
  previousValue?: string | number | boolean;
  newValue: string | number | boolean;
  configId?: string;
}

export interface ConnectionDetails {
  type: 'connection';
  action: 'connect' | 'disconnect' | 'reconnect' | 'validate';
  brokerType: string;
  success: boolean;
  errorMessage?: string;
}

export interface ErrorDetails {
  type: 'error';
  category: 'broker' | 'validation' | 'system' | 'network' | 'unknown';
  errorCode?: string;
  errorMessage: string;
  operation: string;
  recoverable: boolean;
  stackTrace?: string;
}

export type AuditEventDetails =
  | RecommendationDetails
  | ApprovalDetails
  | RejectionDetails
  | ExecutionDetails
  | CancellationDetails
  | FillDetails
  | RiskCheckDetails
  | ConfigChangeDetails
  | ConnectionDetails
  | ErrorDetails;

export interface StoredAuditLogEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  actor: AuditActor;
  accountId: string;
  proposalId?: string;
  orderId?: string;
  correlationId?: string;
  initiatorTag: InitiatorTag;
  details: AuditEventDetails;
  dataSources?: AuditDataSource[];
  summary: string;
  createdAt: string;
  version: number;
  notes?: AuditEntryNote[];
}

// ===========================================================================
// Journal UI Types
// ===========================================================================

export interface DayGroup {
  date: string;
  entries: StoredAuditLogEntry[];
}

export interface JournalStatistics {
  total: number;
  byEventType: Record<string, number>;
  byActor: Record<string, number>;
  byInitiatorTag: Record<string, number>;
}

export interface JournalQueryOptions {
  eventTypes?: AuditEventType[];
  actor?: AuditActor;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  sortOrder?: 'asc' | 'desc';
}

export interface JournalEntriesResponse {
  dayGroups: DayGroup[];
  statistics: JournalStatistics;
  queryOptions: JournalQueryOptions;
}

// ===========================================================================
// Component Props
// ===========================================================================

export interface DecisionJournalProps {
  /** API base URL */
  apiBaseUrl?: string;
  /** Whether in demo mode */
  demoMode?: boolean;
}

export interface JournalEntryCardProps {
  entry: StoredAuditLogEntry;
  onAddNote: (entryId: string, text: string) => Promise<void>;
  onUpdateNote: (entryId: string, noteId: string, text: string) => Promise<void>;
  onDeleteNote: (entryId: string, noteId: string) => Promise<void>;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export interface JournalFiltersProps {
  filters: JournalQueryOptions;
  onFiltersChange: (filters: JournalQueryOptions) => void;
}

// ===========================================================================
// Helper Functions
// ===========================================================================

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

export function formatActor(actor: AuditActor): string {
  const formats: Record<AuditActor, string> = {
    user: 'User',
    agent: 'AI Agent',
    system: 'System',
    broker: 'Broker',
  };
  return formats[actor] || actor;
}

export function getEventTypeIcon(eventType: AuditEventType): string {
  const icons: Record<AuditEventType, string> = {
    recommendation: 'lightbulb',
    approval: 'check-circle',
    rejection: 'x-circle',
    execution: 'play',
    cancellation: 'ban',
    modification: 'edit',
    fill: 'dollar-sign',
    risk_check: 'shield',
    config_change: 'settings',
    connection: 'link',
    error: 'alert-triangle',
  };
  return icons[eventType] || 'circle';
}

export function getEventTypeColor(eventType: AuditEventType): string {
  const colors: Record<AuditEventType, string> = {
    recommendation: 'var(--color-accent)',
    approval: 'var(--color-positive)',
    rejection: 'var(--color-negative)',
    execution: 'var(--color-accent)',
    cancellation: 'var(--color-warning)',
    modification: 'var(--color-text-secondary)',
    fill: 'var(--color-positive)',
    risk_check: 'var(--color-warning)',
    config_change: 'var(--color-text-secondary)',
    connection: 'var(--color-accent)',
    error: 'var(--color-negative)',
  };
  return colors[eventType] || 'var(--color-text-primary)';
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  const formatted = absValue.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `-${formatted}` : formatted;
}
