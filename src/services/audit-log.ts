/**
 * Audit Log Service
 *
 * Provides comprehensive audit trail storage for compliance.
 * Every recommendation, approval, execution, rejection, and cancellation
 * is logged with full context for review and compliance purposes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  type AuditEventType,
  type AuditActor,
  type AuditLogEntry,
  type StoredAuditLogEntry,
  type AuditEventDetails,
  type AuditDataSource,
  type AuditLogQueryOptions,
  type AuditLogQueryResult,
  AuditLogEntrySchema,
  getInitiatorTag,
  generateEventSummary,
  AUDIT_LOG_SCHEMA_VERSION,
} from '../types/audit-log.js';
import { encrypt, decrypt, type EncryptedData } from '../storage/encryption.js';

/**
 * Stored audit log file format
 */
interface AuditLogFile {
  version: number;
  entries: Record<string, EncryptedData>; // key = entry id
  metadata: {
    createdAt: string;
    updatedAt: string;
    entryCount: number;
  };
}

/**
 * Configuration options for AuditLogService
 */
export interface AuditLogServiceOptions {
  /** Directory to store audit log files */
  auditLogDir?: string;
  /** Master password for encryption */
  masterPassword: string;
  /** Maximum entries per file before rotation */
  maxEntriesPerFile?: number;
  /** Maximum number of files to keep */
  maxFiles?: number;
}

/**
 * Logger interface for the audit log service
 */
export interface AuditLogServiceLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

const DEFAULT_AUDIT_LOG_DIR = '.config/audit-logs';
const DEFAULT_MAX_ENTRIES_PER_FILE = 10000;
const DEFAULT_MAX_FILES = 100;

/**
 * Default console logger
 */
const defaultLogger: AuditLogServiceLogger = {
  info: (message, data) =>
    console.log(`[AUDIT LOG] ${message}`, data ? JSON.stringify(data) : ''),
  warn: (message, data) =>
    console.warn(`[AUDIT LOG] ${message}`, data ? JSON.stringify(data) : ''),
  error: (message, data) =>
    console.error(`[AUDIT LOG] ${message}`, data ? JSON.stringify(data) : ''),
};

/**
 * AuditLogService - Manages compliance audit trail
 */
export class AuditLogService {
  private entries: Map<string, StoredAuditLogEntry[]> = new Map(); // key = accountId
  private auditLogDir: string;
  private masterPassword: string;
  private maxEntriesPerFile: number;
  private maxFiles: number;
  private initialized: boolean = false;
  private logger: AuditLogServiceLogger;

  constructor(options: AuditLogServiceOptions, logger?: AuditLogServiceLogger) {
    if (!options.masterPassword || options.masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
    this.masterPassword = options.masterPassword;
    this.auditLogDir = options.auditLogDir || DEFAULT_AUDIT_LOG_DIR;
    this.maxEntriesPerFile = options.maxEntriesPerFile || DEFAULT_MAX_ENTRIES_PER_FILE;
    this.maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
    this.logger = logger || defaultLogger;
  }

  /**
   * Initialize the service
   * - Creates audit log directory if needed
   * - Loads existing entries
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure audit log directory exists
    if (!fs.existsSync(this.auditLogDir)) {
      fs.mkdirSync(this.auditLogDir, { recursive: true, mode: 0o700 });
    }

    // Load existing audit log files
    await this.loadAllEntries();

    this.initialized = true;
    this.logger.info('AuditLogService initialized', {
      entriesLoaded: this.getTotalEntryCount(),
    });
  }

  // ===========================================================================
  // Logging Operations
  // ===========================================================================

  /**
   * Log an audit event
   */
  async log(params: {
    accountId: string;
    eventType: AuditEventType;
    actor: AuditActor;
    details: AuditEventDetails;
    proposalId?: string;
    orderId?: string;
    correlationId?: string;
    dataSources?: AuditDataSource[];
    summary?: string;
  }): Promise<StoredAuditLogEntry> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const initiatorTag = getInitiatorTag(params.actor);
    const summary =
      params.summary ||
      generateEventSummary(params.eventType, params.actor, params.details);

    const entry: AuditLogEntry = {
      id,
      timestamp: now,
      eventType: params.eventType,
      actor: params.actor,
      accountId: params.accountId,
      proposalId: params.proposalId,
      orderId: params.orderId,
      correlationId: params.correlationId,
      initiatorTag,
      details: params.details,
      dataSources: params.dataSources,
      summary,
    };

    // Validate the entry
    const validation = AuditLogEntrySchema.safeParse(entry);
    if (!validation.success) {
      const errorMessage = `Invalid audit log entry: ${validation.error.errors.map((e) => e.message).join(', ')}`;
      this.logger.error(errorMessage, { entry });
      throw new Error(errorMessage);
    }

    const storedEntry: StoredAuditLogEntry = {
      ...entry,
      createdAt: now,
      version: AUDIT_LOG_SCHEMA_VERSION,
    };

    // Add to memory
    const accountEntries = this.entries.get(params.accountId) ?? [];
    accountEntries.push(storedEntry);
    this.entries.set(params.accountId, accountEntries);

    // Persist
    await this.saveAccountEntries(params.accountId);

    this.logger.info('Audit event logged', {
      id,
      eventType: params.eventType,
      actor: params.actor,
      accountId: params.accountId,
      summary,
    });

    return storedEntry;
  }

  /**
   * Log a recommendation event
   */
  async logRecommendation(params: {
    accountId: string;
    strategyType: string;
    underlying: string;
    confidence: 'low' | 'medium' | 'high';
    thesis: string[];
    catalysts: string[];
    contractCount: number;
    estimatedMaxLoss?: number;
    estimatedMaxLossPercent?: number;
    proposalId?: string;
    correlationId?: string;
    dataSources?: AuditDataSource[];
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'recommendation',
      actor: 'agent',
      proposalId: params.proposalId,
      correlationId: params.correlationId,
      dataSources: params.dataSources,
      details: {
        type: 'recommendation',
        strategyType: params.strategyType,
        underlying: params.underlying,
        confidence: params.confidence,
        thesis: params.thesis,
        catalysts: params.catalysts,
        contractCount: params.contractCount,
        estimatedMaxLoss: params.estimatedMaxLoss,
        estimatedMaxLossPercent: params.estimatedMaxLossPercent,
      },
    });
  }

  /**
   * Log an approval event
   */
  async logApproval(params: {
    accountId: string;
    strategyType: string;
    underlying: string;
    orderCount: number;
    estimatedCost: number;
    riskChecksPassed: boolean;
    warnings?: string[];
    proposalId?: string;
    correlationId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'approval',
      actor: 'user',
      proposalId: params.proposalId,
      correlationId: params.correlationId,
      details: {
        type: 'approval',
        strategyType: params.strategyType,
        underlying: params.underlying,
        orderCount: params.orderCount,
        estimatedCost: params.estimatedCost,
        riskChecksPassed: params.riskChecksPassed,
        warnings: params.warnings,
      },
    });
  }

  /**
   * Log a rejection event
   */
  async logRejection(params: {
    accountId: string;
    strategyType: string;
    underlying: string;
    reason?: string;
    rejectedBy: 'user' | 'system';
    failedChecks?: string[];
    proposalId?: string;
    correlationId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'rejection',
      actor: params.rejectedBy === 'user' ? 'user' : 'system',
      proposalId: params.proposalId,
      correlationId: params.correlationId,
      details: {
        type: 'rejection',
        strategyType: params.strategyType,
        underlying: params.underlying,
        reason: params.reason,
        rejectedBy: params.rejectedBy,
        failedChecks: params.failedChecks,
      },
    });
  }

  /**
   * Log an execution event
   */
  async logExecution(params: {
    accountId: string;
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
    proposalId?: string;
    orderId?: string;
    correlationId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'execution',
      actor: 'system',
      proposalId: params.proposalId,
      orderId: params.orderId,
      correlationId: params.correlationId,
      details: {
        type: 'execution',
        symbol: params.symbol,
        underlying: params.underlying,
        side: params.side,
        quantity: params.quantity,
        orderType: params.orderType,
        limitPrice: params.limitPrice,
        idempotencyKey: params.idempotencyKey,
        brokerOrderId: params.brokerOrderId,
        success: params.success,
        errorMessage: params.errorMessage,
        errorCode: params.errorCode,
      },
    });
  }

  /**
   * Log a cancellation event
   */
  async logCancellation(params: {
    accountId: string;
    symbol: string;
    brokerOrderId: string;
    reason?: string;
    success: boolean;
    errorMessage?: string;
    orderId?: string;
    correlationId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'cancellation',
      actor: 'user',
      orderId: params.orderId,
      correlationId: params.correlationId,
      details: {
        type: 'cancellation',
        symbol: params.symbol,
        brokerOrderId: params.brokerOrderId,
        reason: params.reason,
        success: params.success,
        errorMessage: params.errorMessage,
      },
    });
  }

  /**
   * Log a fill event
   */
  async logFill(params: {
    accountId: string;
    symbol: string;
    brokerOrderId: string;
    filledQuantity: number;
    totalQuantity: number;
    fillPrice: number;
    isComplete: boolean;
    commission?: number;
    orderId?: string;
    correlationId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'fill',
      actor: 'broker',
      orderId: params.orderId,
      correlationId: params.correlationId,
      details: {
        type: 'fill',
        symbol: params.symbol,
        brokerOrderId: params.brokerOrderId,
        filledQuantity: params.filledQuantity,
        totalQuantity: params.totalQuantity,
        fillPrice: params.fillPrice,
        isComplete: params.isComplete,
        commission: params.commission,
      },
    });
  }

  /**
   * Log a risk check event
   */
  async logRiskCheck(params: {
    accountId: string;
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
    proposalId?: string;
    correlationId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'risk_check',
      actor: 'system',
      proposalId: params.proposalId,
      correlationId: params.correlationId,
      details: {
        type: 'risk_check',
        trigger: params.trigger,
        symbol: params.symbol,
        passed: params.passed,
        checks: params.checks,
        totalChecks: params.checks.length,
        passedChecks: params.checks.filter((c) => c.passed).length,
      },
    });
  }

  /**
   * Log a config change event
   */
  async logConfigChange(params: {
    accountId: string;
    configType: 'risk_config' | 'auto_reprice' | 'alerts' | 'other';
    field: string;
    previousValue?: string | number | boolean;
    newValue: string | number | boolean;
    configId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'config_change',
      actor: 'user',
      details: {
        type: 'config_change',
        configType: params.configType,
        field: params.field,
        previousValue: params.previousValue,
        newValue: params.newValue,
        configId: params.configId,
      },
    });
  }

  /**
   * Log a connection event
   */
  async logConnection(params: {
    accountId: string;
    action: 'connect' | 'disconnect' | 'reconnect' | 'validate';
    brokerType: string;
    success: boolean;
    errorMessage?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'connection',
      actor: 'user',
      details: {
        type: 'connection',
        action: params.action,
        brokerType: params.brokerType,
        success: params.success,
        errorMessage: params.errorMessage,
      },
    });
  }

  /**
   * Log an error event
   */
  async logError(params: {
    accountId: string;
    category: 'broker' | 'validation' | 'system' | 'network' | 'unknown';
    errorCode?: string;
    errorMessage: string;
    operation: string;
    recoverable: boolean;
    stackTrace?: string;
    proposalId?: string;
    orderId?: string;
    correlationId?: string;
  }): Promise<StoredAuditLogEntry> {
    return this.log({
      accountId: params.accountId,
      eventType: 'error',
      actor: 'system',
      proposalId: params.proposalId,
      orderId: params.orderId,
      correlationId: params.correlationId,
      details: {
        type: 'error',
        category: params.category,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        operation: params.operation,
        recoverable: params.recoverable,
        stackTrace: params.stackTrace,
      },
    });
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Query audit log entries
   */
  query(accountId: string, options?: AuditLogQueryOptions): AuditLogQueryResult {
    let entries = this.entries.get(accountId) ?? [];

    // Apply filters
    if (options?.eventTypes && options.eventTypes.length > 0) {
      entries = entries.filter((e) => options.eventTypes!.includes(e.eventType));
    }

    if (options?.actor) {
      entries = entries.filter((e) => e.actor === options.actor);
    }

    if (options?.initiatorTag) {
      entries = entries.filter((e) => e.initiatorTag === options.initiatorTag);
    }

    if (options?.proposalId) {
      entries = entries.filter((e) => e.proposalId === options.proposalId);
    }

    if (options?.orderId) {
      entries = entries.filter((e) => e.orderId === options.orderId);
    }

    if (options?.correlationId) {
      entries = entries.filter((e) => e.correlationId === options.correlationId);
    }

    if (options?.startDate) {
      const startTime = new Date(options.startDate).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() >= startTime);
    }

    if (options?.endDate) {
      const endTime = new Date(options.endDate).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() <= endTime);
    }

    const totalCount = entries.length;

    // Sort
    const sortOrder = options?.sortOrder ?? 'desc';
    entries = [...entries].sort((a, b) => {
      const diff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return sortOrder === 'desc' ? diff : -diff;
    });

    // Pagination
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? entries.length;
    entries = entries.slice(offset, offset + limit);

    return {
      entries,
      totalCount,
      hasMore: offset + entries.length < totalCount,
    };
  }

  /**
   * Get an entry by ID
   */
  getEntry(accountId: string, entryId: string): StoredAuditLogEntry | null {
    const accountEntries = this.entries.get(accountId);
    if (!accountEntries) {
      return null;
    }
    return accountEntries.find((e) => e.id === entryId) ?? null;
  }

  /**
   * Get entries for a specific proposal
   */
  getProposalHistory(accountId: string, proposalId: string): StoredAuditLogEntry[] {
    return this.query(accountId, { proposalId, sortOrder: 'asc' }).entries;
  }

  /**
   * Get entries by correlation ID (e.g., multi-leg orders)
   */
  getCorrelatedEntries(accountId: string, correlationId: string): StoredAuditLogEntry[] {
    return this.query(accountId, { correlationId, sortOrder: 'asc' }).entries;
  }

  /**
   * Get entries for a specific date range
   */
  getEntriesByDateRange(
    accountId: string,
    startDate: string,
    endDate: string,
    options?: Omit<AuditLogQueryOptions, 'startDate' | 'endDate'>
  ): AuditLogQueryResult {
    return this.query(accountId, { ...options, startDate, endDate });
  }

  /**
   * Get entries grouped by day
   */
  getEntriesGroupedByDay(
    accountId: string,
    options?: AuditLogQueryOptions
  ): Map<string, StoredAuditLogEntry[]> {
    const result = this.query(accountId, { ...options, sortOrder: 'desc' });
    const grouped = new Map<string, StoredAuditLogEntry[]>();

    for (const entry of result.entries) {
      const day = entry.timestamp.split('T')[0]!;
      const dayEntries = grouped.get(day) ?? [];
      dayEntries.push(entry);
      grouped.set(day, dayEntries);
    }

    return grouped;
  }

  /**
   * Get entry count for an account
   */
  getEntryCount(accountId: string): number {
    return (this.entries.get(accountId) ?? []).length;
  }

  /**
   * Get total entry count across all accounts
   */
  getTotalEntryCount(): number {
    let total = 0;
    for (const entries of this.entries.values()) {
      total += entries.length;
    }
    return total;
  }

  /**
   * Get statistics for an account
   */
  getStatistics(accountId: string): {
    total: number;
    byEventType: Record<string, number>;
    byActor: Record<string, number>;
    byInitiatorTag: Record<string, number>;
  } {
    const entries = this.entries.get(accountId) ?? [];
    const byEventType: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    const byInitiatorTag: Record<string, number> = {};

    for (const entry of entries) {
      byEventType[entry.eventType] = (byEventType[entry.eventType] ?? 0) + 1;
      byActor[entry.actor] = (byActor[entry.actor] ?? 0) + 1;
      byInitiatorTag[entry.initiatorTag] = (byInitiatorTag[entry.initiatorTag] ?? 0) + 1;
    }

    return {
      total: entries.length,
      byEventType,
      byActor,
      byInitiatorTag,
    };
  }

  // ===========================================================================
  // Note Operations
  // ===========================================================================

  /**
   * Add a note to an audit log entry
   */
  async addNote(
    accountId: string,
    entryId: string,
    text: string
  ): Promise<StoredAuditLogEntry | null> {
    const accountEntries = this.entries.get(accountId);
    if (!accountEntries) {
      return null;
    }

    const entryIndex = accountEntries.findIndex((e) => e.id === entryId);
    if (entryIndex === -1) {
      return null;
    }

    const entry = accountEntries[entryIndex]!;
    const now = new Date().toISOString();
    const note = {
      id: randomUUID(),
      text,
      addedAt: now,
    };

    // Add note to entry
    const updatedEntry: StoredAuditLogEntry = {
      ...entry,
      notes: [...(entry.notes ?? []), note],
    };

    accountEntries[entryIndex] = updatedEntry;
    this.entries.set(accountId, accountEntries);

    // Persist
    await this.saveAccountEntries(accountId);

    this.logger.info('Note added to audit entry', {
      entryId,
      noteId: note.id,
      accountId,
    });

    return updatedEntry;
  }

  /**
   * Update a note on an audit log entry
   */
  async updateNote(
    accountId: string,
    entryId: string,
    noteId: string,
    text: string
  ): Promise<StoredAuditLogEntry | null> {
    const accountEntries = this.entries.get(accountId);
    if (!accountEntries) {
      return null;
    }

    const entryIndex = accountEntries.findIndex((e) => e.id === entryId);
    if (entryIndex === -1) {
      return null;
    }

    const entry = accountEntries[entryIndex]!;
    if (!entry.notes) {
      return null;
    }

    const noteIndex = entry.notes.findIndex((n) => n.id === noteId);
    if (noteIndex === -1) {
      return null;
    }

    const now = new Date().toISOString();
    const updatedNotes = [...entry.notes];
    updatedNotes[noteIndex] = {
      ...updatedNotes[noteIndex]!,
      text,
      updatedAt: now,
    };

    const updatedEntry: StoredAuditLogEntry = {
      ...entry,
      notes: updatedNotes,
    };

    accountEntries[entryIndex] = updatedEntry;
    this.entries.set(accountId, accountEntries);

    // Persist
    await this.saveAccountEntries(accountId);

    this.logger.info('Note updated on audit entry', {
      entryId,
      noteId,
      accountId,
    });

    return updatedEntry;
  }

  /**
   * Delete a note from an audit log entry
   */
  async deleteNote(
    accountId: string,
    entryId: string,
    noteId: string
  ): Promise<StoredAuditLogEntry | null> {
    const accountEntries = this.entries.get(accountId);
    if (!accountEntries) {
      return null;
    }

    const entryIndex = accountEntries.findIndex((e) => e.id === entryId);
    if (entryIndex === -1) {
      return null;
    }

    const entry = accountEntries[entryIndex]!;
    if (!entry.notes) {
      return null;
    }

    const updatedNotes = entry.notes.filter((n) => n.id !== noteId);
    if (updatedNotes.length === entry.notes.length) {
      // Note not found
      return null;
    }

    const updatedEntry: StoredAuditLogEntry = {
      ...entry,
      notes: updatedNotes.length > 0 ? updatedNotes : undefined,
    };

    accountEntries[entryIndex] = updatedEntry;
    this.entries.set(accountId, accountEntries);

    // Persist
    await this.saveAccountEntries(accountId);

    this.logger.info('Note deleted from audit entry', {
      entryId,
      noteId,
      accountId,
    });

    return updatedEntry;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private getAuditLogFilePath(accountId: string, fileIndex: number = 0): string {
    // Sanitize accountId for filename
    const safeAccountId = accountId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const suffix = fileIndex > 0 ? `-${fileIndex}` : '';
    return path.join(this.auditLogDir, `audit-log-${safeAccountId}${suffix}.json`);
  }

  private async loadAllEntries(): Promise<void> {
    if (!fs.existsSync(this.auditLogDir)) {
      return;
    }

    const files = fs.readdirSync(this.auditLogDir);
    for (const file of files) {
      if (file.startsWith('audit-log-') && file.endsWith('.json')) {
        await this.loadAuditLogFile(path.join(this.auditLogDir, file));
      }
    }
  }

  private async loadAuditLogFile(filePath: string): Promise<void> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const auditLogFile: AuditLogFile = JSON.parse(fileContent);

      for (const [entryId, encryptedData] of Object.entries(auditLogFile.entries)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const storedEntry = JSON.parse(decrypted) as StoredAuditLogEntry;

          const accountId = storedEntry.accountId;

          // Add to entries map
          const accountEntries = this.entries.get(accountId) ?? [];
          accountEntries.push(storedEntry);
          this.entries.set(accountId, accountEntries);
        } catch {
          this.logger.error(`Failed to decrypt audit log entry ${entryId}`);
        }
      }
    } catch {
      this.logger.error(`Failed to load audit log file ${filePath}`);
    }
  }

  private async saveAccountEntries(accountId: string): Promise<void> {
    const accountEntries = this.entries.get(accountId);
    if (!accountEntries || accountEntries.length === 0) {
      // Delete file if no entries
      const filePath = this.getAuditLogFilePath(accountId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return;
    }

    const auditLogFile: AuditLogFile = {
      version: AUDIT_LOG_SCHEMA_VERSION,
      entries: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        entryCount: accountEntries.length,
      },
    };

    for (const entry of accountEntries) {
      const plaintext = JSON.stringify(entry);
      auditLogFile.entries[entry.id] = encrypt(plaintext, this.masterPassword);
    }

    const filePath = this.getAuditLogFilePath(accountId);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Write with restrictive permissions using temp file
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(auditLogFile, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  }

  /**
   * Clear all in-memory data (for shutdown/testing)
   */
  clearMemory(): void {
    this.entries.clear();
    this.initialized = false;
  }

  /**
   * Delete all entries for an account (for testing)
   */
  async clearAccount(accountId: string): Promise<void> {
    this.entries.delete(accountId);
    const filePath = this.getAuditLogFilePath(accountId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Create AuditLogService from environment variables
 */
export async function createAuditLogServiceFromEnv(
  masterPasswordEnvVar: string = 'SECRETS_MASTER_PASSWORD',
  auditLogDirEnvVar: string = 'AUDIT_LOG_DIR'
): Promise<AuditLogService> {
  const masterPassword = process.env[masterPasswordEnvVar];

  if (!masterPassword) {
    throw new Error(
      `Master password not found. Set the ${masterPasswordEnvVar} environment variable.`
    );
  }

  const auditLogDir = process.env[auditLogDirEnvVar] || DEFAULT_AUDIT_LOG_DIR;

  const service = new AuditLogService({
    masterPassword,
    auditLogDir,
  });

  await service.initialize();

  return service;
}

/**
 * Create a standalone audit log function for convenience
 */
export function createAuditLogger(
  service: AuditLogService
): (params: {
  accountId: string;
  eventType: AuditEventType;
  actor: AuditActor;
  details: AuditEventDetails;
  proposalId?: string;
  orderId?: string;
  correlationId?: string;
  dataSources?: AuditDataSource[];
  summary?: string;
}) => Promise<StoredAuditLogEntry> {
  return (params) => service.log(params);
}
