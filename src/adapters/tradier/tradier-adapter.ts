/**
 * Tradier Broker Adapter
 *
 * Implements the BrokerAdapter interface for Tradier brokerage.
 * Supports:
 * - Token-based authentication (OAuth access token)
 * - Account summary retrieval
 * - Positions and orders
 * - Market data and option chains
 *
 * API Documentation: https://documentation.tradier.com/
 */

import type {
  BrokerAdapter,
  BrokerType,
  AccountSummary,
  Position,
  Order,
  OrderRequest,
  Quote,
  OptionChain,
  OptionChainRequest,
  OptionDetails,
  OptionType,
  OrderStatus,
  OrderSide,
  OrderType,
  TimeInForce,
  OptionContract,
  Greeks,
} from '../../types/broker.js';
import {
  BrokerError,
  BrokerErrorCode,
  AuthenticationError,
  RateLimitError,
} from '../../types/errors.js';
import type { BrokerConfig } from '../broker-factory.js';

/**
 * Tradier API base URLs
 */
const TRADIER_API_URLS = {
  sandbox: 'https://sandbox.tradier.com/v1',
  production: 'https://api.tradier.com/v1',
} as const;

/**
 * Tradier API response types
 */
interface TradierProfile {
  profile: {
    account: TradierAccount | TradierAccount[];
  };
}

interface TradierAccount {
  account_number: string;
  classification: string;
  day_trader: boolean;
  option_level: number;
  status: string;
  type: string;
}

interface TradierBalances {
  balances: {
    option_short_value: number;
    total_equity: number;
    account_number: string;
    account_type: string;
    close_pl: number;
    current_requirement: number;
    equity: number;
    long_market_value: number;
    market_value: number;
    open_pl: number;
    option_buying_power: number;
    option_long_value: number;
    option_requirement: number;
    pending_orders_count: number;
    short_market_value: number;
    stock_buying_power: number;
    stock_long_value: number;
    uncleared_funds: number;
    pending_cash: number;
    cash: {
      cash_available: number;
      sweep: number;
      unsettled_funds: number;
    };
    margin?: {
      fed_call: number;
      maintenance_call: number;
      option_buying_power: number;
      stock_buying_power: number;
      stock_short_value: number;
    };
  };
}

interface TradierPosition {
  cost_basis: number;
  date_acquired: string;
  id: number;
  quantity: number;
  symbol: string;
}

interface TradierPositions {
  positions: {
    position: TradierPosition | TradierPosition[] | null;
  } | 'null';
}

interface TradierOrder {
  id: number;
  type: string;
  symbol: string;
  side: string;
  quantity: number;
  status: string;
  duration: string;
  price?: number;
  avg_fill_price?: number;
  exec_quantity?: number;
  last_fill_price?: number;
  last_fill_quantity?: number;
  remaining_quantity?: number;
  create_date: string;
  transaction_date: string;
  class: string;
  option_symbol?: string;
  stop_price?: number;
  leg?: TradierOrderLeg[];
}

interface TradierOrderLeg {
  id: number;
  type: string;
  symbol: string;
  side: string;
  quantity: number;
  status: string;
  duration: string;
  price?: number;
  avg_fill_price?: number;
  exec_quantity?: number;
  option_symbol?: string;
}

interface TradierOrders {
  orders: {
    order: TradierOrder | TradierOrder[] | null;
  } | 'null';
}

interface TradierQuote {
  symbol: string;
  description: string;
  exch: string;
  type: string;
  last: number;
  change: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bid: number;
  ask: number;
  bidsize: number;
  asksize: number;
  underlying?: string;
  strike?: number;
  contract_size?: number;
  expiration_date?: string;
  expiration_type?: string;
  option_type?: string;
  greeks?: TradierGreeks;
}

interface TradierGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  phi: number;
  bid_iv: number;
  mid_iv: number;
  ask_iv: number;
  smv_vol: number;
  updated_at: string;
}

interface TradierQuotes {
  quotes: {
    quote: TradierQuote | TradierQuote[] | null;
  };
}

interface TradierOptionExpiration {
  date: string;
  contract_size: number;
  expiration_type: string;
  strikes: number[];
}

interface TradierExpirations {
  expirations: {
    expiration: TradierOptionExpiration | TradierOptionExpiration[] | null;
  } | null;
}

interface TradierOptionChain {
  options: {
    option: TradierOptionContract[] | null;
  } | null;
}

interface TradierOptionContract {
  symbol: string;
  description: string;
  exch: string;
  type: string;
  last: number | null;
  change: number | null;
  volume: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  bid: number;
  ask: number;
  underlying: string;
  strike: number;
  contract_size: number;
  expiration_date: string;
  expiration_type: string;
  option_type: string;
  open_interest: number;
  greeks?: TradierGreeks;
}

interface TradierOrderResponse {
  order: {
    id: number;
    status: string;
    partner_id: string;
  };
}

/**
 * Tradier Broker Adapter Implementation
 */
export class TradierAdapter implements BrokerAdapter {
  readonly brokerType: BrokerType = 'tradier';
  readonly brokerName = 'Tradier';

  private accessToken: string;
  private accountId: string;
  private baseUrl: string;
  private connected: boolean = false;

  constructor(
    accessToken: string,
    accountId: string,
    sandbox: boolean = true
  ) {
    this.accessToken = accessToken;
    this.accountId = accountId;
    this.baseUrl = sandbox ? TRADIER_API_URLS.sandbox : TRADIER_API_URLS.production;
  }

  /**
   * Make an authenticated request to Tradier API
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) {
        params.append(k, String(v));
      }
      options.body = params.toString();
    }

    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new BrokerError(
        BrokerErrorCode.CONNECTION_FAILED,
        `Failed to connect to Tradier: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.brokerType,
        error
      );
    }

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RateLimitError(
        'Tradier rate limit exceeded',
        this.brokerType,
        retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000
      );
    }

    // Handle authentication errors
    if (response.status === 401) {
      throw new AuthenticationError(
        BrokerErrorCode.AUTHENTICATION_FAILED,
        'Invalid or expired Tradier access token',
        this.brokerType
      );
    }

    if (response.status === 403) {
      throw new AuthenticationError(
        BrokerErrorCode.INSUFFICIENT_PERMISSIONS,
        'Insufficient permissions for this Tradier operation',
        this.brokerType
      );
    }

    // Handle not found
    if (response.status === 404) {
      throw new BrokerError(
        BrokerErrorCode.SYMBOL_NOT_FOUND,
        `Resource not found: ${endpoint}`,
        this.brokerType
      );
    }

    // Handle server errors
    if (response.status >= 500) {
      throw new BrokerError(
        BrokerErrorCode.SERVICE_UNAVAILABLE,
        `Tradier service error: ${response.status}`,
        this.brokerType,
        undefined,
        true // retryable
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new BrokerError(
        BrokerErrorCode.UNKNOWN_ERROR,
        `Tradier API error: ${response.status} - ${errorText}`,
        this.brokerType
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Get account summary including balances and P&L
   */
  async getAccountSummary(): Promise<AccountSummary> {
    const balances = await this.request<TradierBalances>(
      `/accounts/${this.accountId}/balances`
    );

    const b = balances.balances;

    return {
      netLiquidation: b.total_equity,
      buyingPower: b.margin?.option_buying_power ?? b.option_buying_power ?? b.cash.cash_available,
      cash: b.cash.cash_available,
      dailyPnL: b.close_pl,
      unrealizedPnL: b.open_pl,
      currency: 'USD',
      asOf: new Date(),
    };
  }

  /**
   * Get all open positions
   */
  async getPositions(): Promise<Position[]> {
    const response = await this.request<TradierPositions>(
      `/accounts/${this.accountId}/positions`
    );

    if (response.positions === 'null' || !response.positions.position) {
      return [];
    }

    const positions = Array.isArray(response.positions.position)
      ? response.positions.position
      : [response.positions.position];

    // Fetch quotes for all positions to get current prices
    const symbols = positions.map((p) => p.symbol);
    const quotes = await this.getQuotesForSymbols(symbols);
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    return positions.map((pos): Position => {
      const quote = quoteMap.get(pos.symbol);
      const mid = quote ? (quote.bid + quote.ask) / 2 : 0;
      const currentPrice = quote?.last ?? mid;
      const isOption = this.isOptionSymbol(pos.symbol);
      const multiplier = isOption ? 100 : 1;
      const marketValue = pos.quantity * currentPrice * multiplier;
      const totalCost = pos.cost_basis;
      const unrealizedPnL = marketValue - totalCost;
      const unrealizedPnLPercent = totalCost !== 0 ? (unrealizedPnL / Math.abs(totalCost)) * 100 : 0;

      const position: Position = {
        id: String(pos.id),
        symbol: pos.symbol,
        quantity: pos.quantity,
        averageCost: totalCost / (pos.quantity * multiplier),
        currentPrice,
        marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
        assetClass: isOption ? 'option' : 'equity',
      };

      if (isOption && quote) {
        position.optionDetails = this.parseOptionSymbol(pos.symbol, quote);
      }

      return position;
    });
  }

  /**
   * Get all open (unfilled) orders
   */
  async getOpenOrders(): Promise<Order[]> {
    const response = await this.request<TradierOrders>(
      `/accounts/${this.accountId}/orders`
    );

    if (response.orders === 'null' || !response.orders.order) {
      return [];
    }

    const orders = Array.isArray(response.orders.order)
      ? response.orders.order
      : [response.orders.order];

    // Filter to only open orders
    const openStatuses = ['open', 'pending', 'partially_filled'];
    return orders
      .filter((o) => openStatuses.includes(o.status))
      .map((o) => this.mapTradierOrder(o));
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<Order | null> {
    try {
      const response = await this.request<{ order: TradierOrder }>(
        `/accounts/${this.accountId}/orders/${orderId}`
      );

      if (!response.order) {
        return null;
      }

      return this.mapTradierOrder(response.order);
    } catch (error) {
      if (error instanceof BrokerError && error.code === BrokerErrorCode.SYMBOL_NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Place a new order
   */
  async placeOrder(order: OrderRequest, idempotencyKey: string): Promise<Order> {
    const isOption = order.assetClass === 'option';

    const orderParams: Record<string, unknown> = {
      class: isOption ? 'option' : 'equity',
      symbol: isOption ? order.optionDetails?.underlying : order.symbol,
      option_symbol: isOption ? order.symbol : undefined,
      side: this.mapOrderSide(order.side, isOption),
      quantity: order.quantity,
      type: this.mapOrderType(order.orderType),
      duration: this.mapTimeInForce(order.timeInForce),
      tag: idempotencyKey, // Tradier uses 'tag' for client order IDs
    };

    if (order.limitPrice !== undefined) {
      orderParams.price = order.limitPrice;
    }

    if (order.stopPrice !== undefined) {
      orderParams.stop = order.stopPrice;
    }

    // Remove undefined values
    Object.keys(orderParams).forEach((key) => {
      if (orderParams[key] === undefined) {
        delete orderParams[key];
      }
    });

    const response = await this.request<TradierOrderResponse>(
      `/accounts/${this.accountId}/orders`,
      'POST',
      orderParams
    );

    // Fetch the created order to return full details
    const createdOrder = await this.getOrder(String(response.order.id));
    if (!createdOrder) {
      throw new BrokerError(
        BrokerErrorCode.UNKNOWN_ERROR,
        'Order placed but could not retrieve details',
        this.brokerType
      );
    }

    return createdOrder;
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.request(
        `/accounts/${this.accountId}/orders/${orderId}`,
        'DELETE'
      );
      return true;
    } catch (error) {
      if (error instanceof BrokerError) {
        // Order not found (404), already canceled, or already filled
        if (
          error.code === BrokerErrorCode.ORDER_NOT_FOUND ||
          error.code === BrokerErrorCode.SYMBOL_NOT_FOUND ||
          error.message.includes('already')
        ) {
          return false;
        }
      }
      throw error;
    }
  }

  /**
   * Get current quote for a symbol
   */
  async getQuote(symbol: string): Promise<Quote> {
    const response = await this.request<TradierQuotes>(
      `/markets/quotes?symbols=${encodeURIComponent(symbol)}&greeks=true`
    );

    if (!response.quotes?.quote) {
      throw new BrokerError(
        BrokerErrorCode.QUOTE_UNAVAILABLE,
        `No quote available for ${symbol}`,
        this.brokerType
      );
    }

    const quoteData = Array.isArray(response.quotes.quote)
      ? response.quotes.quote[0]
      : response.quotes.quote;

    if (!quoteData) {
      throw new BrokerError(
        BrokerErrorCode.QUOTE_UNAVAILABLE,
        `No quote available for ${symbol}`,
        this.brokerType
      );
    }

    const mid = (quoteData.bid + quoteData.ask) / 2;

    return {
      symbol: quoteData.symbol,
      bid: quoteData.bid,
      ask: quoteData.ask,
      mid,
      last: quoteData.last,
      bidSize: quoteData.bidsize,
      askSize: quoteData.asksize,
      volume: quoteData.volume,
      asOf: new Date(),
    };
  }

  /**
   * Get option chain for an underlying
   */
  async getOptionChain(request: OptionChainRequest): Promise<OptionChain> {
    // First, get the underlying quote for current price
    const underlyingQuote = await this.getQuote(request.symbol);

    // Get available expirations
    const expirations = await this.getOptionExpirations(request.symbol);

    // Filter expirations by DTE
    const now = new Date();
    const filteredExpirations = expirations.filter((exp) => {
      const expDate = new Date(exp);
      const dte = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const minOk = request.minDTE === undefined || dte >= request.minDTE;
      const maxOk = request.maxDTE === undefined || dte <= request.maxDTE;
      return minOk && maxOk;
    });

    // Fetch option contracts for each expiration
    const contracts = new Map<string, OptionContract[]>();

    for (const expiration of filteredExpirations) {
      const chainData = await this.request<TradierOptionChain>(
        `/markets/options/chains?symbol=${encodeURIComponent(request.symbol)}&expiration=${expiration}&greeks=true`
      );

      if (chainData.options?.option) {
        const optionContracts = chainData.options.option
          .filter((opt) => {
            // Filter by strike if specified
            if (request.minStrike !== undefined && opt.strike < request.minStrike) {
              return false;
            }
            if (request.maxStrike !== undefined && opt.strike > request.maxStrike) {
              return false;
            }
            return true;
          })
          .map((opt): OptionContract => ({
            optionSymbol: opt.symbol,
            underlying: opt.underlying,
            strike: opt.strike,
            expiration: new Date(opt.expiration_date),
            optionType: opt.option_type.toLowerCase() as OptionType,
            bid: opt.bid,
            ask: opt.ask,
            mid: (opt.bid + opt.ask) / 2,
            last: opt.last ?? 0,
            volume: opt.volume,
            openInterest: opt.open_interest,
            multiplier: opt.contract_size,
            greeks: opt.greeks
              ? this.mapGreeks(opt.greeks)
              : undefined,
          }));

        contracts.set(expiration, optionContracts);
      }
    }

    return {
      underlying: request.symbol,
      underlyingPrice: underlyingQuote.last,
      expirations: filteredExpirations.map((e) => new Date(e)),
      contracts,
      asOf: new Date(),
    };
  }

  /**
   * Test connection and validate credentials
   */
  async validateConnection(): Promise<boolean> {
    try {
      // Try to get user profile to validate token
      const profile = await this.request<TradierProfile>('/user/profile');

      // Verify the account ID exists in the profile
      const accounts = Array.isArray(profile.profile.account)
        ? profile.profile.account
        : [profile.profile.account];

      const accountExists = accounts.some(
        (a) => a.account_number === this.accountId
      );

      if (!accountExists) {
        throw new BrokerError(
          BrokerErrorCode.ACCOUNT_NOT_FOUND,
          `Account ${this.accountId} not found in profile`,
          this.brokerType
        );
      }

      this.connected = true;
      return true;
    } catch (error) {
      if (error instanceof BrokerError) {
        throw error;
      }
      throw new BrokerError(
        BrokerErrorCode.CONNECTION_FAILED,
        `Failed to validate Tradier connection: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.brokerType,
        error
      );
    }
  }

  /**
   * Disconnect and clean up resources
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    // Tradier doesn't require explicit disconnection
    // Clear sensitive data from memory
    this.accessToken = '';
  }

  // -------------------------------------------------------------------------
  // Helper Methods
  // -------------------------------------------------------------------------

  /**
   * Get quotes for multiple symbols
   */
  private async getQuotesForSymbols(symbols: string[]): Promise<TradierQuote[]> {
    if (symbols.length === 0) {
      return [];
    }

    const response = await this.request<TradierQuotes>(
      `/markets/quotes?symbols=${symbols.map(encodeURIComponent).join(',')}&greeks=true`
    );

    if (!response.quotes?.quote) {
      return [];
    }

    return Array.isArray(response.quotes.quote)
      ? response.quotes.quote
      : [response.quotes.quote];
  }

  /**
   * Get available option expirations for a symbol
   */
  private async getOptionExpirations(symbol: string): Promise<string[]> {
    const response = await this.request<TradierExpirations>(
      `/markets/options/expirations?symbol=${encodeURIComponent(symbol)}`
    );

    if (!response.expirations?.expiration) {
      return [];
    }

    const expirations = Array.isArray(response.expirations.expiration)
      ? response.expirations.expiration
      : [response.expirations.expiration];

    return expirations.map((e) => e.date);
  }

  /**
   * Check if a symbol is an option symbol (OCC format)
   */
  private isOptionSymbol(symbol: string): boolean {
    // OCC option symbols are typically 21+ characters
    // Format: UNDERLYING + YYMMDD + C/P + Strike (8 digits)
    return symbol.length >= 15 && /[CP]\d{8}$/.test(symbol);
  }

  /**
   * Parse OCC option symbol to extract details
   */
  private parseOptionSymbol(symbol: string, quote?: TradierQuote): OptionDetails {
    // Try to use quote data first
    if (quote?.underlying && quote?.strike && quote?.expiration_date && quote?.option_type) {
      return {
        optionSymbol: symbol,
        underlying: quote.underlying,
        strike: quote.strike,
        expiration: new Date(quote.expiration_date),
        optionType: quote.option_type.toLowerCase() as OptionType,
        multiplier: quote.contract_size ?? 100,
        greeks: quote.greeks ? this.mapGreeks(quote.greeks) : undefined,
      };
    }

    // Fallback to parsing the symbol
    // OCC format: AAPL  230120C00150000 (with padding)
    // or: AAPL230120C00150000 (without padding)
    const match = symbol.match(/^([A-Z]+)\s*(\d{6})([CP])(\d{8})$/);
    if (!match || !match[1] || !match[2] || !match[3] || !match[4]) {
      return {
        optionSymbol: symbol,
        underlying: symbol.slice(0, -15).trim(),
        strike: 0,
        expiration: new Date(),
        optionType: 'call',
        multiplier: 100,
      };
    }

    const underlying = match[1];
    const dateStr = match[2];
    const callPut = match[3];
    const strikeStr = match[4];

    const year = 2000 + parseInt(dateStr.slice(0, 2), 10);
    const month = parseInt(dateStr.slice(2, 4), 10) - 1;
    const day = parseInt(dateStr.slice(4, 6), 10);
    const strike = parseInt(strikeStr, 10) / 1000;

    return {
      optionSymbol: symbol,
      underlying,
      strike,
      expiration: new Date(year, month, day),
      optionType: callPut === 'C' ? 'call' : 'put',
      multiplier: 100,
      greeks: quote?.greeks ? this.mapGreeks(quote.greeks) : undefined,
    };
  }

  /**
   * Map Tradier Greeks to our format
   */
  private mapGreeks(greeks: TradierGreeks): Greeks {
    return {
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
      rho: greeks.rho,
      impliedVolatility: greeks.mid_iv,
    };
  }

  /**
   * Map Tradier order to our Order type
   */
  private mapTradierOrder(order: TradierOrder): Order {
    const isOption = order.class === 'option';
    const symbol = isOption && order.option_symbol ? order.option_symbol : order.symbol;

    const mappedOrder: Order = {
      id: String(order.id),
      clientOrderId: undefined, // Tradier doesn't return the tag in order queries
      symbol,
      assetClass: isOption ? 'option' : 'equity',
      side: this.parseTradierSide(order.side),
      orderType: this.parseTradierOrderType(order.type),
      timeInForce: this.parseTradierDuration(order.duration),
      quantity: order.quantity,
      limitPrice: order.price,
      stopPrice: order.stop_price,
      filledQuantity: order.exec_quantity ?? 0,
      averageFillPrice: order.avg_fill_price,
      status: this.mapTradierStatus(order.status),
      submittedAt: new Date(order.create_date),
      filledAt: order.exec_quantity === order.quantity
        ? new Date(order.transaction_date)
        : undefined,
    };

    if (isOption && order.option_symbol) {
      mappedOrder.optionDetails = this.parseOptionSymbol(order.option_symbol);
    }

    return mappedOrder;
  }

  /**
   * Map Tradier order status to our OrderStatus
   */
  private mapTradierStatus(status: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      open: 'open',
      pending: 'pending',
      partially_filled: 'partially_filled',
      filled: 'filled',
      canceled: 'canceled',
      cancelled: 'canceled',
      rejected: 'rejected',
      expired: 'expired',
    };
    return statusMap[status.toLowerCase()] ?? 'pending';
  }

  /**
   * Parse Tradier side to our OrderSide
   */
  private parseTradierSide(side: string): OrderSide {
    // Tradier uses: buy, sell, buy_to_open, sell_to_open, buy_to_close, sell_to_close
    return side.startsWith('buy') ? 'buy' : 'sell';
  }

  /**
   * Parse Tradier order type to our OrderType
   */
  private parseTradierOrderType(type: string): OrderType {
    const typeMap: Record<string, OrderType> = {
      market: 'market',
      limit: 'limit',
      stop: 'stop',
      stop_limit: 'stop_limit',
    };
    return typeMap[type.toLowerCase()] ?? 'limit';
  }

  /**
   * Parse Tradier duration to our TimeInForce
   */
  private parseTradierDuration(duration: string): TimeInForce {
    const durationMap: Record<string, TimeInForce> = {
      day: 'day',
      gtc: 'gtc',
      pre: 'day',
      post: 'day',
    };
    return durationMap[duration.toLowerCase()] ?? 'day';
  }

  /**
   * Map our OrderSide to Tradier side
   */
  private mapOrderSide(side: OrderSide, isOption: boolean): string {
    if (!isOption) {
      return side;
    }
    // For options, use opening/closing semantics
    // For simplicity, assume opening orders (user can specify closing if needed)
    return side === 'buy' ? 'buy_to_open' : 'sell_to_open';
  }

  /**
   * Map our OrderType to Tradier order type
   */
  private mapOrderType(orderType: OrderType): string {
    return orderType;
  }

  /**
   * Map our TimeInForce to Tradier duration
   */
  private mapTimeInForce(tif: TimeInForce): string {
    const tifMap: Record<TimeInForce, string> = {
      day: 'day',
      gtc: 'gtc',
      ioc: 'day', // Tradier doesn't support IOC, fallback to day
      fok: 'day', // Tradier doesn't support FOK, fallback to day
    };
    return tifMap[tif];
  }
}

/**
 * Create a Tradier adapter from broker config
 */
export async function createTradierAdapter(config: BrokerConfig): Promise<TradierAdapter> {
  const accessToken = config.accessToken;
  const accountId = config.accountId;

  if (!accessToken) {
    throw new AuthenticationError(
      BrokerErrorCode.INVALID_CREDENTIALS,
      'Tradier access token is required',
      'tradier'
    );
  }

  if (!accountId) {
    throw new BrokerError(
      BrokerErrorCode.ACCOUNT_NOT_FOUND,
      'Tradier account ID is required',
      'tradier'
    );
  }

  const adapter = new TradierAdapter(
    accessToken,
    accountId,
    config.sandbox ?? true
  );

  return adapter;
}
