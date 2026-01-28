/**
 * Order Submission Service
 *
 * Handles order placement through the broker API with idempotency support.
 * Key features:
 * - Prevents duplicate orders via idempotency keys
 * - Retry logic with exponential backoff for transient failures
 * - Comprehensive error handling for all broker error types
 * - Order state tracking (pending → submitted → filled/failed)
 * - Logging of all submission attempts
 */

import type {
  BrokerAdapter,
  Order,
  OrderRequest,
} from '../types/broker.js';
import {
  BrokerError,
  BrokerErrorCode,
  OrderError,
  RateLimitError,
  isBrokerError,
  isRetryableError,
} from '../types/errors.js';
import {
  OrderSubmissionStore,
  createOrderSubmission,
  type OrderSubmission,
  type OrderSubmissionStatus,
} from '../storage/order-submissions.js';
import type { DraftOrder, BuildDraftOrdersResult } from './draft-order-builder.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a single order submission attempt
 */
export interface OrderSubmissionResult {
  /** Whether the submission was successful */
  success: boolean;
  /** The idempotency key used */
  idempotencyKey: string;
  /** Broker-assigned order ID (if successful) */
  orderId?: string;
  /** The created/retrieved order object (if successful) */
  order?: Order;
  /** Error message (if failed) */
  errorMessage?: string;
  /** Error code (if failed) */
  errorCode?: string;
  /** Whether this was a duplicate (idempotent retry returned existing order) */
  isDuplicate?: boolean;
  /** Number of retry attempts made */
  retryCount: number;
}

/**
 * Result of submitting multiple orders (e.g., multi-leg strategy)
 */
export interface BatchSubmissionResult {
  /** Overall success (all orders submitted) */
  success: boolean;
  /** Individual order results */
  results: OrderSubmissionResult[];
  /** Correlation ID linking these orders */
  correlationId: string;
  /** Proposal ID if from a trade proposal */
  proposalId?: string;
  /** Summary of submission */
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    duplicates: number;
  };
  /** Timestamp of submission */
  submittedAt: string;
}

/**
 * Configuration for the OrderSubmissionService
 */
export interface OrderSubmissionServiceConfig {
  /** Maximum number of retries for transient failures */
  maxRetries?: number;
  /** Base delay for exponential backoff (ms) */
  baseRetryDelayMs?: number;
  /** Maximum delay between retries (ms) */
  maxRetryDelayMs?: number;
  /** Whether to add jitter to retry delays */
  useJitter?: boolean;
  /** Custom logger */
  logger?: OrderSubmissionLogger;
}

/**
 * Logger interface for order submission events
 */
export interface OrderSubmissionLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Default configuration
 */
export const DEFAULT_SUBMISSION_CONFIG: Required<Omit<OrderSubmissionServiceConfig, 'logger'>> = {
  maxRetries: 3,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 30000,
  useJitter: true,
};

/**
 * Default console logger
 */
const defaultLogger: OrderSubmissionLogger = {
  info: (message, context) => console.log(`[OrderSubmission] ${message}`, context ?? ''),
  warn: (message, context) => console.warn(`[OrderSubmission] ${message}`, context ?? ''),
  error: (message, context) => console.error(`[OrderSubmission] ${message}`, context ?? ''),
};

// ============================================================================
// Order Submission Service
// ============================================================================

/**
 * OrderSubmissionService - Handles order placement with idempotency
 *
 * Usage:
 * 1. Create service with adapter and submission store
 * 2. Call submitOrder() with draft order
 * 3. Check result for success/failure
 *
 * Idempotency:
 * - Each order has a unique idempotencyKey (UUID)
 * - If the same key is submitted twice, returns the previous result
 * - Prevents duplicate orders even if client retries
 */
export class OrderSubmissionService {
  private adapter: BrokerAdapter;
  private store: OrderSubmissionStore;
  private accountId: string;
  private config: Required<Omit<OrderSubmissionServiceConfig, 'logger'>>;
  private logger: OrderSubmissionLogger;

  constructor(
    adapter: BrokerAdapter,
    store: OrderSubmissionStore,
    accountId: string,
    config?: OrderSubmissionServiceConfig
  ) {
    this.adapter = adapter;
    this.store = store;
    this.accountId = accountId;
    this.config = {
      ...DEFAULT_SUBMISSION_CONFIG,
      ...config,
    };
    this.logger = config?.logger ?? defaultLogger;
  }

  /**
   * Submit a single order to the broker
   *
   * Handles:
   * - Idempotency check (returns existing result if already submitted)
   * - Retry logic for transient failures
   * - Error categorization and handling
   *
   * @param draftOrder - The draft order to submit
   * @returns Submission result with order ID or error
   */
  async submitOrder(draftOrder: DraftOrder): Promise<OrderSubmissionResult> {
    const { idempotencyKey, orderRequest } = draftOrder;

    this.logger.info('Submitting order', {
      idempotencyKey,
      symbol: orderRequest.symbol,
      side: orderRequest.side,
      quantity: orderRequest.quantity,
    });

    // Check for existing submission with this idempotency key
    const existing = await this.store.getSubmission(this.accountId, idempotencyKey);
    if (existing) {
      return this.handleExistingSubmission(existing);
    }

    // Create new submission record
    const submission = createOrderSubmission({
      idempotencyKey,
      accountId: this.accountId,
      correlationId: undefined, // Set by batch submission
      proposalId: draftOrder.proposalId,
      orderRequest: {
        symbol: orderRequest.symbol,
        side: orderRequest.side,
        quantity: orderRequest.quantity,
        orderType: orderRequest.orderType,
        limitPrice: orderRequest.limitPrice,
        stopPrice: orderRequest.stopPrice,
      },
    });

    // Store the pending submission BEFORE calling broker
    await this.store.storeSubmission(submission);

    // Attempt to place the order with retries
    return this.submitWithRetries(draftOrder, submission);
  }

  /**
   * Submit multiple orders (e.g., multi-leg strategy)
   *
   * @param draftOrders - Result from buildDraftOrders()
   * @returns Batch submission result
   */
  async submitOrders(draftOrders: BuildDraftOrdersResult): Promise<BatchSubmissionResult> {
    const { orders, correlationId, proposalId } = draftOrders;

    this.logger.info('Submitting batch orders', {
      correlationId,
      proposalId,
      orderCount: orders.length,
    });

    const results: OrderSubmissionResult[] = [];
    let succeeded = 0;
    let failed = 0;
    let duplicates = 0;

    // Submit orders sequentially to maintain correlation
    // (Could be parallelized if broker supports atomic multi-leg)
    for (const order of orders) {
      // Update submission record with correlation ID
      const existing = await this.store.getSubmission(this.accountId, order.idempotencyKey);
      if (!existing) {
        // Create submission with correlation ID
        const submission = createOrderSubmission({
          idempotencyKey: order.idempotencyKey,
          accountId: this.accountId,
          correlationId,
          proposalId: order.proposalId ?? proposalId,
          orderRequest: {
            symbol: order.orderRequest.symbol,
            side: order.orderRequest.side,
            quantity: order.orderRequest.quantity,
            orderType: order.orderRequest.orderType,
            limitPrice: order.orderRequest.limitPrice,
            stopPrice: order.orderRequest.stopPrice,
          },
        });
        await this.store.storeSubmission(submission);
      }

      // Submit the order
      const result = await this.submitOrderInternal(order, correlationId);
      results.push(result);

      if (result.success) {
        succeeded++;
        if (result.isDuplicate) {
          duplicates++;
        }
      } else {
        failed++;
        // Continue submitting remaining orders (don't fail entire batch)
        // Caller can decide how to handle partial failures
      }
    }

    const success = failed === 0;

    this.logger.info('Batch submission complete', {
      correlationId,
      success,
      succeeded,
      failed,
      duplicates,
    });

    return {
      success,
      results,
      correlationId,
      proposalId,
      summary: {
        total: orders.length,
        succeeded,
        failed,
        duplicates,
      },
      submittedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the status of a previous submission
   */
  async getSubmissionStatus(idempotencyKey: string): Promise<OrderSubmission | null> {
    return this.store.getSubmission(this.accountId, idempotencyKey);
  }

  /**
   * Get all submissions for a correlation ID (multi-leg order)
   */
  async getCorrelatedSubmissions(correlationId: string): Promise<OrderSubmission[]> {
    return this.store.getSubmissionsByCorrelationId(this.accountId, correlationId);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle an existing submission (idempotent retry)
   */
  private async handleExistingSubmission(
    existing: OrderSubmission
  ): Promise<OrderSubmissionResult> {
    this.logger.info('Found existing submission', {
      idempotencyKey: existing.idempotencyKey,
      status: existing.status,
      brokerOrderId: existing.brokerOrderId,
    });

    switch (existing.status) {
      case 'submitted':
      case 'filled':
      case 'partially_filled':
        // Order was successfully submitted before - return success
        return {
          success: true,
          idempotencyKey: existing.idempotencyKey,
          orderId: existing.brokerOrderId,
          isDuplicate: true,
          retryCount: existing.retryCount,
        };

      case 'pending':
        // Order is currently being submitted (possibly from another request)
        // Wait briefly and check again
        await this.sleep(1000);
        const updated = await this.store.getSubmission(
          this.accountId,
          existing.idempotencyKey
        );
        if (updated && updated.status !== 'pending') {
          return this.handleExistingSubmission(updated);
        }
        // Still pending - treat as error (shouldn't happen normally)
        return {
          success: false,
          idempotencyKey: existing.idempotencyKey,
          errorMessage: 'Order submission is in progress',
          errorCode: 'SUBMISSION_IN_PROGRESS',
          retryCount: existing.retryCount,
        };

      case 'rejected':
      case 'failed':
        // Previous submission failed - return the error
        return {
          success: false,
          idempotencyKey: existing.idempotencyKey,
          errorMessage: existing.errorMessage ?? 'Order submission failed',
          errorCode: existing.errorCode,
          isDuplicate: true,
          retryCount: existing.retryCount,
        };

      case 'canceled':
        // Order was canceled - allow resubmission with new key
        return {
          success: false,
          idempotencyKey: existing.idempotencyKey,
          errorMessage: 'Order was canceled. Use a new idempotency key to resubmit.',
          errorCode: 'ORDER_CANCELED',
          isDuplicate: true,
          retryCount: existing.retryCount,
        };

      default:
        return {
          success: false,
          idempotencyKey: existing.idempotencyKey,
          errorMessage: `Unknown submission status: ${existing.status}`,
          errorCode: 'UNKNOWN_STATUS',
          retryCount: existing.retryCount,
        };
    }
  }

  /**
   * Internal order submission (used by both single and batch)
   */
  private async submitOrderInternal(
    draftOrder: DraftOrder,
    correlationId?: string
  ): Promise<OrderSubmissionResult> {
    const { idempotencyKey } = draftOrder;

    // Check for existing submission
    const existing = await this.store.getSubmission(this.accountId, idempotencyKey);
    if (existing && existing.status !== 'pending') {
      return this.handleExistingSubmission(existing);
    }

    // Get or create submission record
    let submission = existing;
    if (!submission) {
      submission = createOrderSubmission({
        idempotencyKey,
        accountId: this.accountId,
        correlationId,
        proposalId: draftOrder.proposalId,
        orderRequest: {
          symbol: draftOrder.orderRequest.symbol,
          side: draftOrder.orderRequest.side,
          quantity: draftOrder.orderRequest.quantity,
          orderType: draftOrder.orderRequest.orderType,
          limitPrice: draftOrder.orderRequest.limitPrice,
          stopPrice: draftOrder.orderRequest.stopPrice,
        },
      });
      await this.store.storeSubmission(submission);
    }

    return this.submitWithRetries(draftOrder, submission);
  }

  /**
   * Submit order with retry logic
   */
  private async submitWithRetries(
    draftOrder: DraftOrder,
    submission: OrderSubmission
  ): Promise<OrderSubmissionResult> {
    const { idempotencyKey, orderRequest } = draftOrder;
    let lastError: Error | undefined;
    let retryCount = submission.retryCount;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        // Calculate backoff delay
        const delay = this.calculateBackoffDelay(attempt);
        this.logger.info('Retrying order submission', {
          idempotencyKey,
          attempt,
          delayMs: delay,
        });
        await this.sleep(delay);

        // Increment retry count
        retryCount++;
        await this.store.incrementRetryCount(this.accountId, idempotencyKey);
      }

      try {
        // Attempt to place the order
        const order = await this.adapter.placeOrder(orderRequest, idempotencyKey);

        // Success! Update submission record
        await this.store.markSubmitted(this.accountId, idempotencyKey, order.id);

        this.logger.info('Order submitted successfully', {
          idempotencyKey,
          orderId: order.id,
          symbol: order.symbol,
          status: order.status,
        });

        return {
          success: true,
          idempotencyKey,
          orderId: order.id,
          order,
          retryCount,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Categorize the error
        if (this.shouldRetry(error, attempt)) {
          this.logger.warn('Order submission failed, will retry', {
            idempotencyKey,
            attempt,
            error: lastError.message,
          });
          continue;
        }

        // Non-retryable error - fail immediately
        break;
      }
    }

    // All retries exhausted or non-retryable error
    const { errorMessage, errorCode, status } = this.categorizeError(lastError!);

    // Update submission record
    if (status === 'rejected') {
      await this.store.markRejected(this.accountId, idempotencyKey, errorMessage, errorCode);
    } else {
      await this.store.markFailed(this.accountId, idempotencyKey, errorMessage, errorCode);
    }

    this.logger.error('Order submission failed', {
      idempotencyKey,
      errorMessage,
      errorCode,
      retryCount,
    });

    return {
      success: false,
      idempotencyKey,
      errorMessage,
      errorCode,
      retryCount,
    };
  }

  /**
   * Determine if an error should be retried
   */
  private shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.config.maxRetries) {
      return false;
    }

    // Check if error is explicitly retryable
    if (isRetryableError(error)) {
      return true;
    }

    // Check for specific retryable conditions
    if (isBrokerError(error)) {
      switch (error.code) {
        case BrokerErrorCode.RATE_LIMIT_EXCEEDED:
        case BrokerErrorCode.CONNECTION_TIMEOUT:
        case BrokerErrorCode.SERVICE_UNAVAILABLE:
          return true;
        default:
          return false;
      }
    }

    // Network errors are generally retryable
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('econnreset') ||
        message.includes('econnrefused')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate backoff delay with optional jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: delay = base * 2^attempt
    let delay = this.config.baseRetryDelayMs * Math.pow(2, attempt);

    // Cap at max delay
    delay = Math.min(delay, this.config.maxRetryDelayMs);

    // Add jitter (±25%)
    if (this.config.useJitter) {
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      delay += jitter;
    }

    return Math.round(delay);
  }

  /**
   * Categorize an error for storage and reporting
   */
  private categorizeError(error: Error): {
    errorMessage: string;
    errorCode: string;
    status: OrderSubmissionStatus;
  } {
    if (isBrokerError(error)) {
      const isRejection = [
        BrokerErrorCode.INSUFFICIENT_FUNDS,
        BrokerErrorCode.INVALID_ORDER,
        BrokerErrorCode.SYMBOL_NOT_TRADEABLE,
        BrokerErrorCode.MARKET_CLOSED,
        BrokerErrorCode.ACCOUNT_RESTRICTED,
        BrokerErrorCode.PDT_RESTRICTION,
        BrokerErrorCode.DUPLICATE_ORDER,
      ].includes(error.code);

      return {
        errorMessage: error.toUserMessage(),
        errorCode: error.code,
        status: isRejection ? 'rejected' : 'failed',
      };
    }

    return {
      errorMessage: error.message,
      errorCode: 'UNKNOWN_ERROR',
      status: 'failed',
    };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create an OrderSubmissionService
 */
export function createOrderSubmissionService(
  adapter: BrokerAdapter,
  store: OrderSubmissionStore,
  accountId: string,
  config?: OrderSubmissionServiceConfig
): OrderSubmissionService {
  return new OrderSubmissionService(adapter, store, accountId, config);
}

/**
 * Standalone function to submit a single order
 */
export async function submitOrder(
  adapter: BrokerAdapter,
  store: OrderSubmissionStore,
  accountId: string,
  draftOrder: DraftOrder,
  config?: OrderSubmissionServiceConfig
): Promise<OrderSubmissionResult> {
  const service = new OrderSubmissionService(adapter, store, accountId, config);
  return service.submitOrder(draftOrder);
}

/**
 * Standalone function to submit multiple orders
 */
export async function submitOrders(
  adapter: BrokerAdapter,
  store: OrderSubmissionStore,
  accountId: string,
  draftOrders: BuildDraftOrdersResult,
  config?: OrderSubmissionServiceConfig
): Promise<BatchSubmissionResult> {
  const service = new OrderSubmissionService(adapter, store, accountId, config);
  return service.submitOrders(draftOrders);
}
