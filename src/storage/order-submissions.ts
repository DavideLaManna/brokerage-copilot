/**
 * Order Submission Storage
 *
 * Tracks submitted orders for idempotency and audit trail.
 * Prevents duplicate order submissions by storing idempotency keys
 * and their associated order results.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { encrypt, decrypt, type EncryptedData } from './encryption.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Status of an order submission
 */
export type OrderSubmissionStatus =
  | 'pending'      // Order is being submitted
  | 'submitted'    // Order successfully submitted to broker
  | 'filled'       // Order has been filled
  | 'partially_filled' // Order partially filled
  | 'rejected'     // Broker rejected the order
  | 'failed'       // Failed to submit (network error, etc.)
  | 'canceled';    // Order was canceled

/**
 * Record of a submitted order
 */
export interface OrderSubmission {
  /** Client-generated idempotency key (UUID) */
  idempotencyKey: string;
  /** Account this order was submitted for */
  accountId: string;
  /** Broker-assigned order ID (set after successful submission) */
  brokerOrderId?: string;
  /** Correlation ID linking related orders (e.g., multi-leg strategies) */
  correlationId?: string;
  /** Trade proposal ID if applicable */
  proposalId?: string;
  /** Current status of the submission */
  status: OrderSubmissionStatus;
  /** The order request that was submitted */
  orderRequest: {
    symbol: string;
    side: 'buy' | 'sell';
    quantity: number;
    orderType: string;
    limitPrice?: number;
    stopPrice?: number;
  };
  /** Timestamp when submission was initiated */
  submittedAt: string;
  /** Timestamp when broker confirmed (or rejected) */
  confirmedAt?: string;
  /** Timestamp of last status update */
  updatedAt: string;
  /** Error message if submission failed */
  errorMessage?: string;
  /** Error code if submission failed */
  errorCode?: string;
  /** Number of retry attempts */
  retryCount: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Zod schema for order submission validation
 */
export const OrderSubmissionSchema = z.object({
  idempotencyKey: z.string().uuid(),
  accountId: z.string().min(1),
  brokerOrderId: z.string().optional(),
  correlationId: z.string().uuid().optional(),
  proposalId: z.string().uuid().optional(),
  status: z.enum(['pending', 'submitted', 'filled', 'partially_filled', 'rejected', 'failed', 'canceled']),
  orderRequest: z.object({
    symbol: z.string().min(1),
    side: z.enum(['buy', 'sell']),
    quantity: z.number().positive(),
    orderType: z.string(),
    limitPrice: z.number().optional(),
    stopPrice: z.number().optional(),
  }),
  submittedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  retryCount: z.number().int().min(0),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * File format for stored submissions
 */
interface SubmissionsFile {
  version: number;
  submissions: Record<string, EncryptedData>;
  metadata: {
    createdAt: string;
    updatedAt: string;
  };
}

// ============================================================================
// Order Submission Store
// ============================================================================

/**
 * Configuration for OrderSubmissionStore
 */
export interface OrderSubmissionStoreConfig {
  /** Master password for encryption */
  masterPassword: string;
  /** Base path for storage files */
  storagePath?: string;
  /** Max submissions to keep per account (0 = unlimited) */
  maxSubmissionsPerAccount?: number;
  /** Max age of submissions to keep in milliseconds (0 = unlimited) */
  maxSubmissionAgeMs?: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  storagePath: '.config/order-submissions',
  maxSubmissionsPerAccount: 10000,
  maxSubmissionAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * OrderSubmissionStore - Tracks submitted orders for idempotency
 *
 * Key features:
 * - Prevents duplicate order submissions via idempotency keys
 * - Encrypted storage for sensitive order data
 * - Per-account isolation
 * - Automatic cleanup of old submissions
 */
export class OrderSubmissionStore {
  private submissions: Map<string, Map<string, OrderSubmission>> = new Map();
  private masterPassword: string;
  private storagePath: string;
  private maxSubmissionsPerAccount: number;
  private maxSubmissionAgeMs: number;
  private initialized: boolean = false;

  constructor(config: OrderSubmissionStoreConfig) {
    if (!config.masterPassword || config.masterPassword.length < 8) {
      throw new Error('Master password must be at least 8 characters');
    }
    this.masterPassword = config.masterPassword;
    this.storagePath = config.storagePath ?? DEFAULT_CONFIG.storagePath;
    this.maxSubmissionsPerAccount = config.maxSubmissionsPerAccount ?? DEFAULT_CONFIG.maxSubmissionsPerAccount;
    this.maxSubmissionAgeMs = config.maxSubmissionAgeMs ?? DEFAULT_CONFIG.maxSubmissionAgeMs;
  }

  /**
   * Initialize the store
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure storage directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true, mode: 0o700 });
    }

    this.initialized = true;
  }

  /**
   * Get a submission by idempotency key
   */
  async getSubmission(accountId: string, idempotencyKey: string): Promise<OrderSubmission | null> {
    await this.ensureAccountLoaded(accountId);
    const accountSubmissions = this.submissions.get(accountId);
    return accountSubmissions?.get(idempotencyKey) ?? null;
  }

  /**
   * Check if an idempotency key has been used
   */
  async hasIdempotencyKey(accountId: string, idempotencyKey: string): Promise<boolean> {
    const submission = await this.getSubmission(accountId, idempotencyKey);
    return submission !== null;
  }

  /**
   * Store a new submission (called when initiating order placement)
   */
  async storeSubmission(submission: OrderSubmission): Promise<void> {
    // Validate submission
    const validation = OrderSubmissionSchema.safeParse(submission);
    if (!validation.success) {
      throw new Error(`Invalid submission: ${validation.error.message}`);
    }

    await this.ensureAccountLoaded(submission.accountId);

    // Check if this idempotency key already exists
    const accountSubmissions = this.submissions.get(submission.accountId)!;
    if (accountSubmissions.has(submission.idempotencyKey)) {
      throw new Error(`Idempotency key already exists: ${submission.idempotencyKey}`);
    }

    // Store the submission
    accountSubmissions.set(submission.idempotencyKey, submission);

    // Persist to disk
    await this.saveAccount(submission.accountId);
  }

  /**
   * Update an existing submission (called when order status changes)
   */
  async updateSubmission(
    accountId: string,
    idempotencyKey: string,
    updates: Partial<Omit<OrderSubmission, 'idempotencyKey' | 'accountId' | 'submittedAt'>>
  ): Promise<OrderSubmission | null> {
    await this.ensureAccountLoaded(accountId);

    const accountSubmissions = this.submissions.get(accountId)!;
    const existing = accountSubmissions.get(idempotencyKey);

    if (!existing) {
      return null;
    }

    // Merge updates
    const updated: OrderSubmission = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    // Validate
    const validation = OrderSubmissionSchema.safeParse(updated);
    if (!validation.success) {
      throw new Error(`Invalid submission update: ${validation.error.message}`);
    }

    // Store and persist
    accountSubmissions.set(idempotencyKey, updated);
    await this.saveAccount(accountId);

    return updated;
  }

  /**
   * Mark a submission as successfully submitted
   */
  async markSubmitted(
    accountId: string,
    idempotencyKey: string,
    brokerOrderId: string
  ): Promise<OrderSubmission | null> {
    return this.updateSubmission(accountId, idempotencyKey, {
      status: 'submitted',
      brokerOrderId,
      confirmedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark a submission as failed
   */
  async markFailed(
    accountId: string,
    idempotencyKey: string,
    errorMessage: string,
    errorCode?: string
  ): Promise<OrderSubmission | null> {
    return this.updateSubmission(accountId, idempotencyKey, {
      status: 'failed',
      errorMessage,
      errorCode,
      confirmedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark a submission as rejected by broker
   */
  async markRejected(
    accountId: string,
    idempotencyKey: string,
    errorMessage: string,
    errorCode?: string
  ): Promise<OrderSubmission | null> {
    return this.updateSubmission(accountId, idempotencyKey, {
      status: 'rejected',
      errorMessage,
      errorCode,
      confirmedAt: new Date().toISOString(),
    });
  }

  /**
   * Increment retry count for a submission
   */
  async incrementRetryCount(accountId: string, idempotencyKey: string): Promise<OrderSubmission | null> {
    const existing = await this.getSubmission(accountId, idempotencyKey);
    if (!existing) {
      return null;
    }

    return this.updateSubmission(accountId, idempotencyKey, {
      retryCount: existing.retryCount + 1,
    });
  }

  /**
   * Get all submissions for an account
   */
  async getAccountSubmissions(
    accountId: string,
    options?: {
      status?: OrderSubmissionStatus;
      correlationId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<OrderSubmission[]> {
    await this.ensureAccountLoaded(accountId);

    const accountSubmissions = this.submissions.get(accountId);
    if (!accountSubmissions) {
      return [];
    }

    let submissions = Array.from(accountSubmissions.values());

    // Filter by status
    if (options?.status) {
      submissions = submissions.filter(s => s.status === options.status);
    }

    // Filter by correlation ID
    if (options?.correlationId) {
      submissions = submissions.filter(s => s.correlationId === options.correlationId);
    }

    // Sort by submission time (newest first)
    submissions.sort((a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

    // Apply pagination
    if (options?.offset) {
      submissions = submissions.slice(options.offset);
    }
    if (options?.limit) {
      submissions = submissions.slice(0, options.limit);
    }

    return submissions;
  }

  /**
   * Get submissions by correlation ID (for multi-leg orders)
   */
  async getSubmissionsByCorrelationId(
    accountId: string,
    correlationId: string
  ): Promise<OrderSubmission[]> {
    return this.getAccountSubmissions(accountId, { correlationId });
  }

  /**
   * Clean up old submissions
   */
  async cleanup(accountId: string): Promise<number> {
    await this.ensureAccountLoaded(accountId);

    const accountSubmissions = this.submissions.get(accountId);
    if (!accountSubmissions) {
      return 0;
    }

    const now = Date.now();
    let removedCount = 0;

    // Remove old submissions
    if (this.maxSubmissionAgeMs > 0) {
      for (const [key, submission] of accountSubmissions) {
        const submissionAge = now - new Date(submission.submittedAt).getTime();
        if (submissionAge > this.maxSubmissionAgeMs) {
          // Only remove completed submissions (not pending ones)
          if (submission.status !== 'pending') {
            accountSubmissions.delete(key);
            removedCount++;
          }
        }
      }
    }

    // Enforce max submissions limit (keep newest)
    if (this.maxSubmissionsPerAccount > 0 && accountSubmissions.size > this.maxSubmissionsPerAccount) {
      const submissions = Array.from(accountSubmissions.entries())
        .sort((a, b) => new Date(b[1].submittedAt).getTime() - new Date(a[1].submittedAt).getTime());

      const toRemove = submissions.slice(this.maxSubmissionsPerAccount);
      for (const [key, submission] of toRemove) {
        // Only remove completed submissions
        if (submission.status !== 'pending') {
          accountSubmissions.delete(key);
          removedCount++;
        }
      }
    }

    if (removedCount > 0) {
      await this.saveAccount(accountId);
    }

    return removedCount;
  }

  /**
   * Delete a specific submission
   */
  async deleteSubmission(accountId: string, idempotencyKey: string): Promise<boolean> {
    await this.ensureAccountLoaded(accountId);

    const accountSubmissions = this.submissions.get(accountId);
    if (!accountSubmissions) {
      return false;
    }

    const existed = accountSubmissions.delete(idempotencyKey);
    if (existed) {
      await this.saveAccount(accountId);
    }

    return existed;
  }

  /**
   * Clear all submissions for an account
   */
  async clearAccount(accountId: string): Promise<void> {
    this.submissions.delete(accountId);

    const filePath = this.getAccountFilePath(accountId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getAccountFilePath(accountId: string): string {
    // Sanitize account ID for filesystem
    const safeAccountId = accountId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.storagePath, `${safeAccountId}.json`);
  }

  private async ensureAccountLoaded(accountId: string): Promise<void> {
    if (this.submissions.has(accountId)) {
      return;
    }

    await this.initialize();
    await this.loadAccount(accountId);
  }

  private async loadAccount(accountId: string): Promise<void> {
    const filePath = this.getAccountFilePath(accountId);

    if (!fs.existsSync(filePath)) {
      this.submissions.set(accountId, new Map());
      return;
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const submissionsFile: SubmissionsFile = JSON.parse(fileContent);
      const accountSubmissions = new Map<string, OrderSubmission>();

      for (const [key, encryptedData] of Object.entries(submissionsFile.submissions)) {
        try {
          const decrypted = decrypt(encryptedData, this.masterPassword);
          const submission = JSON.parse(decrypted) as OrderSubmission;
          accountSubmissions.set(key, submission);
        } catch {
          // Failed to decrypt - skip this submission
          console.error(`Failed to decrypt submission ${key} for account ${accountId}`);
        }
      }

      this.submissions.set(accountId, accountSubmissions);
    } catch {
      // Failed to load file - start fresh
      console.error(`Failed to load submissions for account ${accountId}`);
      this.submissions.set(accountId, new Map());
    }
  }

  private async saveAccount(accountId: string): Promise<void> {
    const accountSubmissions = this.submissions.get(accountId);
    if (!accountSubmissions) {
      return;
    }

    const submissionsFile: SubmissionsFile = {
      version: 1,
      submissions: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    for (const [key, submission] of accountSubmissions) {
      const plaintext = JSON.stringify(submission);
      submissionsFile.submissions[key] = encrypt(plaintext, this.masterPassword);
    }

    const filePath = this.getAccountFilePath(accountId);
    const tempPath = `${filePath}.tmp`;

    fs.writeFileSync(tempPath, JSON.stringify(submissionsFile, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
  }
}

/**
 * Create OrderSubmissionStore from environment variables
 */
export async function createOrderSubmissionStoreFromEnv(
  masterPasswordEnvVar: string = 'SECRETS_MASTER_PASSWORD',
  storagePathEnvVar: string = 'ORDER_SUBMISSIONS_PATH'
): Promise<OrderSubmissionStore> {
  const masterPassword = process.env[masterPasswordEnvVar];

  if (!masterPassword) {
    throw new Error(
      `Master password not found. Set the ${masterPasswordEnvVar} environment variable.`
    );
  }

  const storagePath = process.env[storagePathEnvVar] || DEFAULT_CONFIG.storagePath;

  const store = new OrderSubmissionStore({
    masterPassword,
    storagePath,
  });
  await store.initialize();

  return store;
}

/**
 * Create a new OrderSubmission record
 */
export function createOrderSubmission(params: {
  idempotencyKey: string;
  accountId: string;
  correlationId?: string;
  proposalId?: string;
  orderRequest: OrderSubmission['orderRequest'];
  metadata?: Record<string, unknown>;
}): OrderSubmission {
  const now = new Date().toISOString();
  return {
    idempotencyKey: params.idempotencyKey,
    accountId: params.accountId,
    correlationId: params.correlationId,
    proposalId: params.proposalId,
    status: 'pending',
    orderRequest: params.orderRequest,
    submittedAt: now,
    updatedAt: now,
    retryCount: 0,
    metadata: params.metadata,
  };
}
