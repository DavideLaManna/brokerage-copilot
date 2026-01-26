/**
 * Broker Adapter Interface Types
 *
 * Unified interface for broker operations supporting multiple brokers:
 * - Alpaca (paper + live trading)
 * - Tradier
 * - tastytrade
 * - Interactive Brokers (IBKR)
 */

import { z } from 'zod';

// ============================================================================
// Core Enums and Constants
// ============================================================================

export type OptionType = 'call' | 'put';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';
export type OrderStatus =
  | 'pending'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'canceled'
  | 'rejected'
  | 'expired';

export type BrokerType = 'alpaca' | 'tradier' | 'tastytrade' | 'ibkr';

// ============================================================================
// Account & Position Types
// ============================================================================

export interface AccountSummary {
  /** Net liquidation value of the account */
  netLiquidation: number;
  /** Available buying power */
  buyingPower: number;
  /** Cash balance */
  cash: number;
  /** Daily realized P&L */
  dailyPnL: number;
  /** Total unrealized P&L */
  unrealizedPnL: number;
  /** Currency (e.g., 'USD') */
  currency: string;
  /** Timestamp of data retrieval */
  asOf: Date;
}

export interface Position {
  /** Unique position identifier */
  id: string;
  /** Underlying symbol (e.g., 'AAPL') */
  symbol: string;
  /** Number of contracts (positive = long, negative = short) */
  quantity: number;
  /** Average cost basis per contract */
  averageCost: number;
  /** Current market price per contract */
  currentPrice: number;
  /** Current market value */
  marketValue: number;
  /** Unrealized P&L */
  unrealizedPnL: number;
  /** Unrealized P&L percentage */
  unrealizedPnLPercent: number;
  /** Asset class: 'equity' or 'option' */
  assetClass: 'equity' | 'option';
  /** Option-specific details (only present for options) */
  optionDetails?: OptionDetails;
}

export interface OptionDetails {
  /** OCC option symbol or broker-specific identifier */
  optionSymbol: string;
  /** Underlying ticker */
  underlying: string;
  /** Strike price */
  strike: number;
  /** Expiration date */
  expiration: Date;
  /** Call or put */
  optionType: OptionType;
  /** Contract multiplier (usually 100) */
  multiplier: number;
  /** Greeks if available */
  greeks?: Greeks;
}

export interface Greeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  impliedVolatility?: number;
}

// ============================================================================
// Order Types
// ============================================================================

export interface Order {
  /** Broker-assigned order ID */
  id: string;
  /** Client-generated idempotency key */
  clientOrderId?: string;
  /** Symbol (equity symbol or option symbol) */
  symbol: string;
  /** Asset class */
  assetClass: 'equity' | 'option';
  /** Buy or sell */
  side: OrderSide;
  /** Order type */
  orderType: OrderType;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Quantity (contracts for options, shares for equity) */
  quantity: number;
  /** Limit price (for limit/stop_limit orders) */
  limitPrice?: number;
  /** Stop price (for stop/stop_limit orders) */
  stopPrice?: number;
  /** Filled quantity */
  filledQuantity: number;
  /** Average fill price */
  averageFillPrice?: number;
  /** Current order status */
  status: OrderStatus;
  /** Time order was submitted */
  submittedAt: Date;
  /** Time order was filled (if applicable) */
  filledAt?: Date;
  /** Option details (if option order) */
  optionDetails?: OptionDetails;
}

export interface OrderRequest {
  /** Symbol to trade */
  symbol: string;
  /** Asset class */
  assetClass: 'equity' | 'option';
  /** Buy or sell */
  side: OrderSide;
  /** Order type */
  orderType: OrderType;
  /** Time in force */
  timeInForce: TimeInForce;
  /** Quantity */
  quantity: number;
  /** Limit price (required for limit/stop_limit) */
  limitPrice?: number;
  /** Stop price (required for stop/stop_limit) */
  stopPrice?: number;
  /** Client-generated idempotency key (UUID recommended) */
  clientOrderId?: string;
  /** Option details (required for option orders) */
  optionDetails?: {
    underlying: string;
    strike: number;
    expiration: Date;
    optionType: OptionType;
  };
}

// ============================================================================
// Quote & Option Chain Types
// ============================================================================

export interface Quote {
  /** Symbol */
  symbol: string;
  /** Bid price */
  bid: number;
  /** Ask price */
  ask: number;
  /** Mid price */
  mid: number;
  /** Last traded price */
  last: number;
  /** Bid size */
  bidSize: number;
  /** Ask size */
  askSize: number;
  /** Volume */
  volume: number;
  /** Timestamp of quote */
  asOf: Date;
}

export interface OptionContract {
  /** OCC symbol or broker-specific option identifier */
  optionSymbol: string;
  /** Underlying symbol */
  underlying: string;
  /** Strike price */
  strike: number;
  /** Expiration date */
  expiration: Date;
  /** Call or put */
  optionType: OptionType;
  /** Bid price */
  bid: number;
  /** Ask price */
  ask: number;
  /** Mid price */
  mid: number;
  /** Last traded price */
  last: number;
  /** Volume */
  volume: number;
  /** Open interest */
  openInterest: number;
  /** Greeks */
  greeks?: Greeks;
  /** Contract multiplier (usually 100) */
  multiplier: number;
}

export interface OptionChain {
  /** Underlying symbol */
  underlying: string;
  /** Current underlying price */
  underlyingPrice: number;
  /** Available expiration dates */
  expirations: Date[];
  /** Option contracts grouped by expiration */
  contracts: Map<string, OptionContract[]>; // key = expiration ISO string
  /** Timestamp of chain data */
  asOf: Date;
}

export interface OptionChainRequest {
  /** Underlying symbol */
  symbol: string;
  /** Minimum days to expiration */
  minDTE?: number;
  /** Maximum days to expiration */
  maxDTE?: number;
  /** Minimum strike price */
  minStrike?: number;
  /** Maximum strike price */
  maxStrike?: number;
}

// ============================================================================
// Historical Price Data Types
// ============================================================================

/** Supported time intervals for historical bars */
export type BarInterval = 'minute' | '5min' | '15min' | 'hourly' | 'daily' | 'weekly' | 'monthly';

/**
 * A single price bar (OHLCV candlestick)
 */
export interface HistoricalBar {
  /** Bar timestamp (start of the period) */
  timestamp: Date;
  /** Opening price */
  open: number;
  /** Highest price during period */
  high: number;
  /** Lowest price during period */
  low: number;
  /** Closing price */
  close: number;
  /** Trading volume during period */
  volume: number;
  /** Volume-weighted average price (if available) */
  vwap?: number;
}

/**
 * Request parameters for historical bars
 */
export interface HistoricalBarsRequest {
  /** Ticker symbol */
  symbol: string;
  /** Time interval for bars */
  interval: BarInterval;
  /** Start date for historical data */
  start?: Date;
  /** End date for historical data (defaults to now) */
  end?: Date;
  /** Number of bars to retrieve (alternative to start/end) */
  limit?: number;
}

/**
 * Response containing historical bar data
 */
export interface HistoricalBarsResponse {
  /** Ticker symbol */
  symbol: string;
  /** Time interval */
  interval: BarInterval;
  /** Array of price bars, sorted chronologically (oldest first) */
  bars: HistoricalBar[];
  /** Timestamp when data was retrieved */
  asOf: Date;
}

// ============================================================================
// Broker Adapter Interface
// ============================================================================

/**
 * Unified interface for all broker adapters.
 * Each broker implementation must conform to this interface.
 */
export interface BrokerAdapter {
  /** Broker identifier */
  readonly brokerType: BrokerType;

  /** Human-readable broker name */
  readonly brokerName: string;

  // -------------------------------------------------------------------------
  // Account Operations
  // -------------------------------------------------------------------------

  /**
   * Get account summary including balances and P&L.
   * @returns Account summary data
   */
  getAccountSummary(): Promise<AccountSummary>;

  // -------------------------------------------------------------------------
  // Position Operations
  // -------------------------------------------------------------------------

  /**
   * Get all open positions.
   * @returns Array of current positions
   */
  getPositions(): Promise<Position[]>;

  // -------------------------------------------------------------------------
  // Order Operations
  // -------------------------------------------------------------------------

  /**
   * Get all open (unfilled) orders.
   * @returns Array of open orders
   */
  getOpenOrders(): Promise<Order[]>;

  /**
   * Get order by ID.
   * @param orderId - Broker-assigned order ID
   * @returns Order details or null if not found
   */
  getOrder(orderId: string): Promise<Order | null>;

  /**
   * Place a new order.
   * @param order - Order request details
   * @param idempotencyKey - Client-generated key to prevent duplicate orders
   * @returns Created order with broker-assigned ID
   */
  placeOrder(order: OrderRequest, idempotencyKey: string): Promise<Order>;

  /**
   * Cancel an existing order.
   * @param orderId - Broker-assigned order ID to cancel
   * @returns true if cancellation request was accepted
   */
  cancelOrder(orderId: string): Promise<boolean>;

  // -------------------------------------------------------------------------
  // Market Data Operations
  // -------------------------------------------------------------------------

  /**
   * Get current quote for a symbol.
   * @param symbol - Ticker symbol
   * @returns Current quote data
   */
  getQuote(symbol: string): Promise<Quote>;

  /**
   * Get option chain for an underlying.
   * @param request - Option chain request parameters
   * @returns Option chain data
   */
  getOptionChain(request: OptionChainRequest): Promise<OptionChain>;

  /**
   * Get historical price bars for technical analysis.
   * @param request - Historical bars request parameters
   * @returns Historical bars data
   */
  getHistoricalBars(request: HistoricalBarsRequest): Promise<HistoricalBarsResponse>;

  // -------------------------------------------------------------------------
  // Connection Management
  // -------------------------------------------------------------------------

  /**
   * Test connection and validate credentials.
   * @returns true if connection is valid
   */
  validateConnection(): Promise<boolean>;

  /**
   * Disconnect and clean up resources.
   */
  disconnect(): Promise<void>;
}

// ============================================================================
// Zod Schemas for Runtime Validation
// ============================================================================

export const AccountSummarySchema = z.object({
  netLiquidation: z.number(),
  buyingPower: z.number(),
  cash: z.number(),
  dailyPnL: z.number(),
  unrealizedPnL: z.number(),
  currency: z.string(),
  asOf: z.date(),
});

export const GreeksSchema = z.object({
  delta: z.number().optional(),
  gamma: z.number().optional(),
  theta: z.number().optional(),
  vega: z.number().optional(),
  rho: z.number().optional(),
  impliedVolatility: z.number().optional(),
});

export const OptionDetailsSchema = z.object({
  optionSymbol: z.string(),
  underlying: z.string(),
  strike: z.number(),
  expiration: z.date(),
  optionType: z.enum(['call', 'put']),
  multiplier: z.number(),
  greeks: GreeksSchema.optional(),
});

export const PositionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  quantity: z.number(),
  averageCost: z.number(),
  currentPrice: z.number(),
  marketValue: z.number(),
  unrealizedPnL: z.number(),
  unrealizedPnLPercent: z.number(),
  assetClass: z.enum(['equity', 'option']),
  optionDetails: OptionDetailsSchema.optional(),
});

export const OrderRequestSchema = z.object({
  symbol: z.string().min(1),
  assetClass: z.enum(['equity', 'option']),
  side: z.enum(['buy', 'sell']),
  orderType: z.enum(['market', 'limit', 'stop', 'stop_limit']),
  timeInForce: z.enum(['day', 'gtc', 'ioc', 'fok']),
  quantity: z.number().int().positive(),
  limitPrice: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  clientOrderId: z.string().uuid().optional(),
  optionDetails: z
    .object({
      underlying: z.string(),
      strike: z.number().positive(),
      expiration: z.date(),
      optionType: z.enum(['call', 'put']),
    })
    .optional(),
});

export const OptionChainRequestSchema = z.object({
  symbol: z.string().min(1),
  minDTE: z.number().int().nonnegative().optional(),
  maxDTE: z.number().int().positive().optional(),
  minStrike: z.number().positive().optional(),
  maxStrike: z.number().positive().optional(),
});

export const BarIntervalSchema = z.enum([
  'minute',
  '5min',
  '15min',
  'hourly',
  'daily',
  'weekly',
  'monthly',
]);

export const HistoricalBarSchema = z.object({
  timestamp: z.date(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().int().nonnegative(),
  vwap: z.number().optional(),
});

export const HistoricalBarsRequestSchema = z.object({
  symbol: z.string().min(1),
  interval: BarIntervalSchema,
  start: z.date().optional(),
  end: z.date().optional(),
  limit: z.number().int().positive().optional(),
});
