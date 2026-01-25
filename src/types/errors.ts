/**
 * Broker Error Types
 *
 * Standardized error types for broker operations.
 * All broker adapters should throw these error types for consistent error handling.
 */

/**
 * Error codes for broker operations
 */
export enum BrokerErrorCode {
  // Authentication errors (1xx)
  AUTHENTICATION_FAILED = 'AUTH_001',
  TOKEN_EXPIRED = 'AUTH_002',
  INVALID_CREDENTIALS = 'AUTH_003',
  INSUFFICIENT_PERMISSIONS = 'AUTH_004',

  // Connection errors (2xx)
  CONNECTION_FAILED = 'CONN_001',
  CONNECTION_TIMEOUT = 'CONN_002',
  SERVICE_UNAVAILABLE = 'CONN_003',

  // Rate limiting errors (3xx)
  RATE_LIMIT_EXCEEDED = 'RATE_001',
  DAILY_LIMIT_EXCEEDED = 'RATE_002',

  // Order errors (4xx)
  INSUFFICIENT_FUNDS = 'ORDER_001',
  INVALID_ORDER = 'ORDER_002',
  ORDER_NOT_FOUND = 'ORDER_003',
  ORDER_ALREADY_FILLED = 'ORDER_004',
  ORDER_ALREADY_CANCELED = 'ORDER_005',
  SYMBOL_NOT_TRADEABLE = 'ORDER_006',
  MARKET_CLOSED = 'ORDER_007',
  POSITION_NOT_FOUND = 'ORDER_008',
  DUPLICATE_ORDER = 'ORDER_009',

  // Market data errors (5xx)
  QUOTE_UNAVAILABLE = 'DATA_001',
  OPTION_CHAIN_UNAVAILABLE = 'DATA_002',
  SYMBOL_NOT_FOUND = 'DATA_003',

  // Account errors (6xx)
  ACCOUNT_RESTRICTED = 'ACCT_001',
  ACCOUNT_NOT_FOUND = 'ACCT_002',
  PDT_RESTRICTION = 'ACCT_003',

  // Unknown errors
  UNKNOWN_ERROR = 'UNKNOWN',
}

/**
 * Base class for all broker-related errors
 */
export class BrokerError extends Error {
  constructor(
    public readonly code: BrokerErrorCode,
    message: string,
    public readonly brokerType?: string,
    public readonly originalError?: unknown,
    public readonly retryable: boolean = false,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'BrokerError';

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BrokerError);
    }
  }

  /**
   * Create a user-friendly error message
   */
  toUserMessage(): string {
    switch (this.code) {
      case BrokerErrorCode.AUTHENTICATION_FAILED:
      case BrokerErrorCode.INVALID_CREDENTIALS:
        return 'Failed to authenticate with broker. Please check your credentials.';
      case BrokerErrorCode.TOKEN_EXPIRED:
        return 'Your session has expired. Please reconnect your broker account.';
      case BrokerErrorCode.INSUFFICIENT_PERMISSIONS:
        return 'Your account does not have permission for this operation.';
      case BrokerErrorCode.CONNECTION_FAILED:
      case BrokerErrorCode.CONNECTION_TIMEOUT:
        return 'Unable to connect to broker. Please try again.';
      case BrokerErrorCode.SERVICE_UNAVAILABLE:
        return 'Broker service is temporarily unavailable. Please try again later.';
      case BrokerErrorCode.RATE_LIMIT_EXCEEDED:
        return `Rate limit exceeded. ${this.retryAfterMs ? `Please wait ${Math.ceil(this.retryAfterMs / 1000)} seconds.` : 'Please try again later.'}`;
      case BrokerErrorCode.DAILY_LIMIT_EXCEEDED:
        return 'Daily API limit exceeded. Please try again tomorrow.';
      case BrokerErrorCode.INSUFFICIENT_FUNDS:
        return 'Insufficient buying power for this order.';
      case BrokerErrorCode.INVALID_ORDER:
        return 'Invalid order parameters. Please review and try again.';
      case BrokerErrorCode.ORDER_NOT_FOUND:
        return 'Order not found.';
      case BrokerErrorCode.ORDER_ALREADY_FILLED:
        return 'Cannot modify or cancel - order has already been filled.';
      case BrokerErrorCode.ORDER_ALREADY_CANCELED:
        return 'Order has already been canceled.';
      case BrokerErrorCode.SYMBOL_NOT_TRADEABLE:
        return 'This symbol is not available for trading.';
      case BrokerErrorCode.MARKET_CLOSED:
        return 'Market is currently closed.';
      case BrokerErrorCode.DUPLICATE_ORDER:
        return 'A duplicate order was detected and rejected.';
      case BrokerErrorCode.QUOTE_UNAVAILABLE:
        return 'Quote data is temporarily unavailable.';
      case BrokerErrorCode.OPTION_CHAIN_UNAVAILABLE:
        return 'Option chain data is temporarily unavailable.';
      case BrokerErrorCode.SYMBOL_NOT_FOUND:
        return 'Symbol not found.';
      case BrokerErrorCode.ACCOUNT_RESTRICTED:
        return 'Your account has restrictions. Please contact your broker.';
      case BrokerErrorCode.PDT_RESTRICTION:
        return 'Pattern day trader restriction applies to this account.';
      default:
        return this.message;
    }
  }
}

/**
 * Authentication-specific error
 */
export class AuthenticationError extends BrokerError {
  constructor(
    code:
      | BrokerErrorCode.AUTHENTICATION_FAILED
      | BrokerErrorCode.TOKEN_EXPIRED
      | BrokerErrorCode.INVALID_CREDENTIALS
      | BrokerErrorCode.INSUFFICIENT_PERMISSIONS,
    message: string,
    brokerType?: string,
    originalError?: unknown
  ) {
    super(code, message, brokerType, originalError, false);
    this.name = 'AuthenticationError';
  }
}

/**
 * Rate limit error with retry information
 */
export class RateLimitError extends BrokerError {
  constructor(
    message: string,
    brokerType?: string,
    retryAfterMs?: number,
    originalError?: unknown
  ) {
    super(
      BrokerErrorCode.RATE_LIMIT_EXCEEDED,
      message,
      brokerType,
      originalError,
      true,
      retryAfterMs
    );
    this.name = 'RateLimitError';
  }
}

/**
 * Order-specific error
 */
export class OrderError extends BrokerError {
  constructor(
    code: BrokerErrorCode,
    message: string,
    public readonly orderId?: string,
    brokerType?: string,
    originalError?: unknown
  ) {
    super(code, message, brokerType, originalError, false);
    this.name = 'OrderError';
  }
}

/**
 * Type guard to check if an error is a BrokerError
 */
export function isBrokerError(error: unknown): error is BrokerError {
  return error instanceof BrokerError;
}

/**
 * Type guard to check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (isBrokerError(error)) {
    return error.retryable;
  }
  return false;
}
