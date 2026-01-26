/**
 * UI Types for Options Trading Copilot Dashboard
 *
 * These types mirror the backend types in src/types/broker.ts
 * but are defined separately for the UI to maintain independence.
 */

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

export interface AccountSummary {
  netLiquidation: number;
  buyingPower: number;
  cash: number;
  dailyPnL: number;
  unrealizedPnL: number;
  currency: string;
  asOf: Date;
}

export interface Greeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  impliedVolatility?: number;
}

export interface OptionDetails {
  optionSymbol: string;
  underlying: string;
  strike: number;
  expiration: Date;
  optionType: OptionType;
  multiplier: number;
  greeks?: Greeks;
}

export interface Position {
  id: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  assetClass: 'equity' | 'option';
  optionDetails?: OptionDetails;
}

export interface Order {
  id: string;
  clientOrderId?: string;
  symbol: string;
  assetClass: 'equity' | 'option';
  side: OrderSide;
  orderType: OrderType;
  timeInForce: TimeInForce;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  filledQuantity: number;
  averageFillPrice?: number;
  status: OrderStatus;
  submittedAt: Date;
  filledAt?: Date;
  optionDetails?: OptionDetails;
}

export interface ConnectionState {
  connected: boolean;
  brokerName: string;
  accountId?: string;
  lastUpdated?: Date;
}
