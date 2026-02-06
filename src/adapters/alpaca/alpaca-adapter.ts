/**
 * Alpaca Broker Adapter
 *
 * Implements the BrokerAdapter interface for Alpaca brokerage.
 * Supports:
 * - API Key/Secret authentication
 * - Account summary retrieval
 * - Positions and orders
 * - Market data and option chains
 *
 * API Documentation: https://docs.alpaca.markets/
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
  HistoricalBarsRequest,
  HistoricalBarsResponse,
  HistoricalBar,
  BarInterval,
} from '../../types/broker.js';
import {
  BrokerError,
  BrokerErrorCode,
  AuthenticationError,
  RateLimitError,
} from '../../types/errors.js';
import type { BrokerConfig } from '../broker-factory.js';

/**
 * Alpaca API base URLs
 */
const ALPACA_API_URLS = {
  paper: 'https://paper-api.alpaca.markets',
  live: 'https://api.alpaca.markets',
  data: 'https://data.alpaca.markets',
} as const;

/**
 * Alpaca API response types
 */
interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  crypto_status: string;
  currency: string;
  buying_power: string;
  regt_buying_power: string;
  daytrading_buying_power: string;
  non_marginable_buying_power: string;
  cash: string;
  accrued_fees: string;
  pending_transfer_in: string;
  portfolio_value: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  transfers_blocked: boolean;
  account_blocked: boolean;
  created_at: string;
  trade_suspended_by_user: boolean;
  multiplier: string;
  shorting_enabled: boolean;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  initial_margin: string;
  maintenance_margin: string;
  last_maintenance_margin: string;
  sma: string;
  daytrade_count: number;
  options_buying_power: string;
  options_approved_level: number;
  options_trading_level: number;
}

interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  asset_marginable: boolean;
  qty: string;
  avg_entry_price: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
  qty_available: string;
}

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  replaces: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  notional: string | null;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: string;
  order_type: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  extended_hours: boolean;
  legs: AlpacaOrderLeg[] | null;
  trail_percent: string | null;
  trail_price: string | null;
  hwm: string | null;
}

interface AlpacaOrderLeg {
  id: string;
  symbol: string;
  asset_class: string;
  qty: string;
  side: string;
  position_intent: string;
  ratio_qty: string;
}

interface AlpacaQuote {
  symbol: string;
  bid_price: number;
  bid_size: number;
  ask_price: number;
  ask_size: number;
  last_trade_price: number;
  last_trade_size: number;
  timestamp: string;
}

interface AlpacaLatestQuote {
  quote: {
    t: string;
    ax: string;
    ap: number;
    as: number;
    bx: string;
    bp: number;
    bs: number;
    c: string[];
    z: string;
  };
  symbol: string;
}

interface AlpacaLatestTrade {
  trade: {
    t: string;
    x: string;
    p: number;
    s: number;
    c: string[];
    i: number;
    z: string;
  };
  symbol: string;
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  vw: number;
}

interface AlpacaBarsResponse {
  bars: Record<string, AlpacaBar[]>;
  next_page_token: string | null;
}

interface AlpacaOptionContract {
  id: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  expiration_date: string;
  root_symbol: string;
  underlying_symbol: string;
  underlying_asset_id: string;
  type: 'call' | 'put';
  style: string;
  strike_price: string;
  multiplier: string;
  size: string;
  open_interest: string | null;
  open_interest_date: string | null;
  close_price: string | null;
  close_price_date: string | null;
}

interface AlpacaOptionQuote {
  symbol: string;
  latest_quote: {
    t: string;
    ax: string;
    ap: number;
    as: number;
    bx: string;
    bp: number;
    bs: number;
    c: string;
  };
  latest_trade?: {
    t: string;
    x: string;
    p: number;
    s: number;
    c: string;
  };
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
    implied_volatility: number;
  };
}

/**
 * Alpaca Broker Adapter Implementation
 */
export class AlpacaAdapter implements BrokerAdapter {
  readonly brokerType: BrokerType = 'alpaca';
  readonly brokerName = 'Alpaca';

  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private dataUrl: string;
  private connected: boolean = false;

  constructor(
    apiKey: string,
    apiSecret: string,
    sandbox: boolean = true
  ) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = sandbox ? ALPACA_API_URLS.paper : ALPACA_API_URLS.live;
    this.dataUrl = ALPACA_API_URLS.data;
  }

  /**
   * Make an authenticated request to Alpaca Trading API
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: Record<string, unknown>,
    useDataApi: boolean = false
  ): Promise<T> {
    const baseUrl = useDataApi ? this.dataUrl : this.baseUrl;
    const url = `${baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.apiSecret,
      'Accept': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new BrokerError(
        BrokerErrorCode.CONNECTION_FAILED,
        `Failed to connect to Alpaca: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.brokerType,
        error
      );
    }

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RateLimitError(
        'Alpaca rate limit exceeded',
        this.brokerType,
        retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000
      );
    }

    // Handle authentication errors
    if (response.status === 401) {
      throw new AuthenticationError(
        BrokerErrorCode.AUTHENTICATION_FAILED,
        'Invalid or expired Alpaca API credentials',
        this.brokerType
      );
    }

    if (response.status === 403) {
      throw new AuthenticationError(
        BrokerErrorCode.INSUFFICIENT_PERMISSIONS,
        'Insufficient permissions for this Alpaca operation',
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
        `Alpaca service error: ${response.status}`,
        this.brokerType,
        undefined,
        true // retryable
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new BrokerError(
        BrokerErrorCode.UNKNOWN_ERROR,
        `Alpaca API error: ${response.status} - ${errorText}`,
        this.brokerType
      );
    }

    // Handle empty responses (e.g., DELETE)
    const contentLength = response.headers.get('Content-Length');
    if (contentLength === '0' || response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  /**
   * Get account summary including balances and P&L
   */
  async getAccountSummary(): Promise<AccountSummary> {
    const account = await this.request<AlpacaAccount>('/v2/account');

    const equity = parseFloat(account.equity);
    const lastEquity = parseFloat(account.last_equity);
    const dailyPnL = equity - lastEquity;

    return {
      netLiquidation: parseFloat(account.portfolio_value),
      buyingPower: parseFloat(account.buying_power),
      cash: parseFloat(account.cash),
      dailyPnL,
      unrealizedPnL: 0, // Will be calculated from positions
      currency: account.currency,
      asOf: new Date(),
    };
  }

  /**
   * Get all open positions
   */
  async getPositions(): Promise<Position[]> {
    const positions = await this.request<AlpacaPosition[]>('/v2/positions');

    return positions.map((pos): Position => {
      const isOption = pos.asset_class === 'us_option';
      const quantity = parseFloat(pos.qty);
      const avgCost = parseFloat(pos.avg_entry_price);
      const currentPrice = parseFloat(pos.current_price);
      const marketValue = parseFloat(pos.market_value);
      const unrealizedPnL = parseFloat(pos.unrealized_pl);
      const unrealizedPnLPercent = parseFloat(pos.unrealized_plpc) * 100;

      const position: Position = {
        id: pos.asset_id,
        symbol: pos.symbol,
        quantity,
        averageCost: avgCost,
        currentPrice,
        marketValue,
        unrealizedPnL,
        unrealizedPnLPercent,
        assetClass: isOption ? 'option' : 'equity',
      };

      if (isOption) {
        position.optionDetails = this.parseOptionSymbol(pos.symbol);
      }

      return position;
    });
  }

  /**
   * Get all open (unfilled) orders
   */
  async getOpenOrders(): Promise<Order[]> {
    const orders = await this.request<AlpacaOrder[]>('/v2/orders?status=open');
    return orders.map((o) => this.mapAlpacaOrder(o));
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<Order | null> {
    try {
      const order = await this.request<AlpacaOrder>(`/v2/orders/${orderId}`);
      return this.mapAlpacaOrder(order);
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
      symbol: order.symbol,
      qty: order.quantity.toString(),
      side: order.side,
      type: order.orderType,
      time_in_force: this.mapTimeInForce(order.timeInForce),
      client_order_id: idempotencyKey,
    };

    if (order.limitPrice !== undefined) {
      orderParams.limit_price = order.limitPrice.toString();
    }

    if (order.stopPrice !== undefined) {
      orderParams.stop_price = order.stopPrice.toString();
    }

    const response = await this.request<AlpacaOrder>('/v2/orders', 'POST', orderParams);
    return this.mapAlpacaOrder(response);
  }

  /**
   * Cancel an existing order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.request(`/v2/orders/${orderId}`, 'DELETE');
      return true;
    } catch (error) {
      if (error instanceof BrokerError) {
        if (
          error.code === BrokerErrorCode.ORDER_NOT_FOUND ||
          error.code === BrokerErrorCode.SYMBOL_NOT_FOUND
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
    // Get latest quote from market data API
    const quoteResponse = await this.request<{ quotes: Record<string, AlpacaLatestQuote['quote']> }>(
      `/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`,
      'GET',
      undefined,
      true
    );

    // Get latest trade for last price
    let lastPrice = 0;
    try {
      const tradeResponse = await this.request<{ trade: AlpacaLatestTrade['trade'] }>(
        `/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`,
        'GET',
        undefined,
        true
      );
      lastPrice = tradeResponse.trade.p;
    } catch {
      // Use mid price if trade not available
    }

    const quote = quoteResponse.quotes?.[symbol] || (quoteResponse as unknown as { quote: AlpacaLatestQuote['quote'] }).quote;

    if (!quote) {
      throw new BrokerError(
        BrokerErrorCode.QUOTE_UNAVAILABLE,
        `No quote available for ${symbol}`,
        this.brokerType
      );
    }

    const bid = quote.bp;
    const ask = quote.ap;
    const mid = (bid + ask) / 2;

    return {
      symbol,
      bid,
      ask,
      mid,
      last: lastPrice || mid,
      bidSize: quote.bs,
      askSize: quote.as,
      volume: 0, // Not available in quote endpoint
      asOf: new Date(quote.t),
    };
  }

  /**
   * Get option chain for an underlying
   */
  async getOptionChain(request: OptionChainRequest): Promise<OptionChain> {
    // Get underlying quote first
    const underlyingQuote = await this.getQuote(request.symbol);

    // Build query params for option contracts
    const params = new URLSearchParams({
      underlying_symbols: request.symbol,
      status: 'active',
      limit: '1000',
    });

    if (request.minStrike !== undefined) {
      params.set('strike_price_gte', request.minStrike.toString());
    }
    if (request.maxStrike !== undefined) {
      params.set('strike_price_lte', request.maxStrike.toString());
    }

    // Calculate date range based on DTE
    const now = new Date();
    if (request.minDTE !== undefined) {
      const minDate = new Date(now.getTime() + request.minDTE * 24 * 60 * 60 * 1000);
      params.set('expiration_date_gte', minDate.toISOString().split('T')[0]!);
    }
    if (request.maxDTE !== undefined) {
      const maxDate = new Date(now.getTime() + request.maxDTE * 24 * 60 * 60 * 1000);
      params.set('expiration_date_lte', maxDate.toISOString().split('T')[0]!);
    }

    const contractsResponse = await this.request<{ option_contracts: AlpacaOptionContract[] }>(
      `/v1/options/contracts?${params.toString()}`,
      'GET',
      undefined,
      true
    );

    const contracts = contractsResponse.option_contracts || [];

    // Get quotes for option contracts
    const contractSymbols = contracts.map(c => c.symbol);
    const optionQuotes = new Map<string, AlpacaOptionQuote>();

    // Batch quote requests (max 100 per request)
    for (let i = 0; i < contractSymbols.length; i += 100) {
      const batch = contractSymbols.slice(i, i + 100);
      try {
        const quotesResponse = await this.request<{ snapshots: Record<string, AlpacaOptionQuote> }>(
          `/v1beta1/options/snapshots?symbols=${batch.join(',')}`,
          'GET',
          undefined,
          true
        );
        for (const [sym, quote] of Object.entries(quotesResponse.snapshots || {})) {
          optionQuotes.set(sym, quote);
        }
      } catch {
        // Continue without quotes if they fail
      }
    }

    // Group by expiration
    const contractsByExpiration = new Map<string, OptionContract[]>();
    const expirations = new Set<string>();

    for (const contract of contracts) {
      const expDate = contract.expiration_date;
      expirations.add(expDate);

      if (!contractsByExpiration.has(expDate)) {
        contractsByExpiration.set(expDate, []);
      }

      const quote = optionQuotes.get(contract.symbol);
      const bid = quote?.latest_quote?.bp ?? 0;
      const ask = quote?.latest_quote?.ap ?? 0;
      const last = quote?.latest_trade?.p ?? 0;

      contractsByExpiration.get(expDate)!.push({
        optionSymbol: contract.symbol,
        underlying: contract.underlying_symbol,
        strike: parseFloat(contract.strike_price),
        expiration: new Date(contract.expiration_date),
        optionType: contract.type as OptionType,
        bid,
        ask,
        mid: (bid + ask) / 2,
        last,
        volume: 0,
        openInterest: contract.open_interest ? parseInt(contract.open_interest) : 0,
        multiplier: parseInt(contract.multiplier),
        greeks: quote?.greeks ? {
          delta: quote.greeks.delta,
          gamma: quote.greeks.gamma,
          theta: quote.greeks.theta,
          vega: quote.greeks.vega,
          rho: quote.greeks.rho,
          impliedVolatility: quote.greeks.implied_volatility,
        } : undefined,
      });
    }

    return {
      underlying: request.symbol,
      underlyingPrice: underlyingQuote.last,
      expirations: Array.from(expirations).sort().map(e => new Date(e)),
      contracts: contractsByExpiration,
      asOf: new Date(),
    };
  }

  /**
   * Get historical price bars for technical analysis
   */
  async getHistoricalBars(request: HistoricalBarsRequest): Promise<HistoricalBarsResponse> {
    const { symbol, interval, start, end, limit } = request;

    // Map interval to Alpaca timeframe
    const timeframeMap: Record<BarInterval, string> = {
      minute: '1Min',
      '5min': '5Min',
      '15min': '15Min',
      hourly: '1Hour',
      daily: '1Day',
      weekly: '1Week',
      monthly: '1Month',
    };
    const timeframe = timeframeMap[interval];

    // Build query params
    const params = new URLSearchParams({
      timeframe,
      adjustment: 'split',
    });

    if (start) {
      params.set('start', start.toISOString());
    }
    if (end) {
      params.set('end', end.toISOString());
    }
    if (limit) {
      params.set('limit', limit.toString());
    }

    const response = await this.request<AlpacaBarsResponse>(
      `/v2/stocks/${encodeURIComponent(symbol)}/bars?${params.toString()}`,
      'GET',
      undefined,
      true
    );

    const rawBars = response.bars?.[symbol] || [];

    const bars: HistoricalBar[] = rawBars.map((bar): HistoricalBar => ({
      timestamp: new Date(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
      vwap: bar.vw,
    }));

    // Sort chronologically (oldest first)
    bars.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      symbol,
      interval,
      bars,
      asOf: new Date(),
    };
  }

  /**
   * Test connection and validate credentials
   */
  async validateConnection(): Promise<boolean> {
    try {
      const account = await this.request<AlpacaAccount>('/v2/account');

      if (account.status !== 'ACTIVE') {
        throw new BrokerError(
          BrokerErrorCode.ACCOUNT_NOT_FOUND,
          `Alpaca account status is ${account.status}, expected ACTIVE`,
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
        `Failed to validate Alpaca connection: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
    // Clear sensitive data from memory
    this.apiKey = '';
    this.apiSecret = '';
  }

  // -------------------------------------------------------------------------
  // Helper Methods
  // -------------------------------------------------------------------------

  /**
   * Parse OCC option symbol to extract details
   */
  private parseOptionSymbol(symbol: string): OptionDetails {
    // OCC format: AAPL230120C00150000
    // or Alpaca format may vary
    const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d{8})$/);
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
    };
  }

  /**
   * Map Alpaca order to our Order type
   */
  private mapAlpacaOrder(order: AlpacaOrder): Order {
    const isOption = order.asset_class === 'us_option';

    const mappedOrder: Order = {
      id: order.id,
      clientOrderId: order.client_order_id,
      symbol: order.symbol,
      assetClass: isOption ? 'option' : 'equity',
      side: order.side as OrderSide,
      orderType: this.parseAlpacaOrderType(order.type),
      timeInForce: this.parseAlpacaTimeInForce(order.time_in_force),
      quantity: parseInt(order.qty),
      limitPrice: order.limit_price ? parseFloat(order.limit_price) : undefined,
      stopPrice: order.stop_price ? parseFloat(order.stop_price) : undefined,
      filledQuantity: parseInt(order.filled_qty),
      averageFillPrice: order.filled_avg_price ? parseFloat(order.filled_avg_price) : undefined,
      status: this.mapAlpacaStatus(order.status),
      submittedAt: new Date(order.submitted_at),
      filledAt: order.filled_at ? new Date(order.filled_at) : undefined,
    };

    if (isOption) {
      mappedOrder.optionDetails = this.parseOptionSymbol(order.symbol);
    }

    return mappedOrder;
  }

  /**
   * Map Alpaca order status to our OrderStatus
   */
  private mapAlpacaStatus(status: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      new: 'pending',
      accepted: 'open',
      pending_new: 'pending',
      accepted_for_bidding: 'open',
      partially_filled: 'partially_filled',
      filled: 'filled',
      done_for_day: 'open',
      canceled: 'canceled',
      expired: 'expired',
      replaced: 'canceled',
      pending_cancel: 'open',
      pending_replace: 'open',
      stopped: 'open',
      rejected: 'rejected',
      suspended: 'open',
      calculated: 'open',
    };
    return statusMap[status.toLowerCase()] ?? 'pending';
  }

  /**
   * Parse Alpaca order type to our OrderType
   */
  private parseAlpacaOrderType(type: string): OrderType {
    const typeMap: Record<string, OrderType> = {
      market: 'market',
      limit: 'limit',
      stop: 'stop',
      stop_limit: 'stop_limit',
    };
    return typeMap[type.toLowerCase()] ?? 'limit';
  }

  /**
   * Parse Alpaca time in force to our TimeInForce
   */
  private parseAlpacaTimeInForce(tif: string): TimeInForce {
    const tifMap: Record<string, TimeInForce> = {
      day: 'day',
      gtc: 'gtc',
      ioc: 'ioc',
      fok: 'fok',
      opg: 'day',
      cls: 'day',
    };
    return tifMap[tif.toLowerCase()] ?? 'day';
  }

  /**
   * Map our TimeInForce to Alpaca format
   */
  private mapTimeInForce(tif: TimeInForce): string {
    return tif;
  }
}

/**
 * Create an Alpaca adapter from broker config
 */
export async function createAlpacaAdapter(config: BrokerConfig): Promise<AlpacaAdapter> {
  const apiKey = config.apiKey;
  const apiSecret = config.apiSecret;

  if (!apiKey) {
    throw new AuthenticationError(
      BrokerErrorCode.INVALID_CREDENTIALS,
      'Alpaca API key is required',
      'alpaca'
    );
  }

  if (!apiSecret) {
    throw new AuthenticationError(
      BrokerErrorCode.INVALID_CREDENTIALS,
      'Alpaca API secret is required',
      'alpaca'
    );
  }

  const adapter = new AlpacaAdapter(
    apiKey,
    apiSecret,
    config.sandbox ?? true
  );

  return adapter;
}
