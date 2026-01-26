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

// ============================================================================
// Liquidity Types
// ============================================================================

export type LiquidityRating = 'high' | 'medium' | 'low' | 'very_low';

export interface LiquidityMetrics {
  spread: number;
  spreadPercent: number;
  midPrice: number;
  volume: number;
  openInterest: number;
  rating: LiquidityRating;
  lowLiquidityWarning: boolean;
  description: string;
}

export interface OptionContract {
  optionSymbol: string;
  underlying: string;
  strike: number;
  expiration: Date;
  optionType: OptionType;
  bid: number;
  ask: number;
  mid: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks?: Greeks;
  multiplier: number;
  liquidity?: LiquidityMetrics;
}

export interface OptionChain {
  underlying: string;
  underlyingPrice: number;
  expirations: Date[];
  contracts: Record<string, OptionContract[]>;
  asOf: Date;
}

// ============================================================================
// Exposure Types
// ============================================================================

export interface AggregatedGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface PositionSummary {
  id: string;
  symbol: string;
  assetClass: 'equity' | 'option';
  quantity: number;
  marketValue: number;
  notionalExposure: number;
  risk: number;
  optionType?: 'call' | 'put';
  strike?: number;
  dte?: number;
}

export interface UnderlyingExposure {
  symbol: string;
  notionalExposure: number;
  risk: number;
  exposurePercent: number;
  riskPercent: number;
  positionCount: number;
  netQuantity: number;
  marketValue: number;
  unrealizedPnL: number;
  exceedsLimit: boolean;
  warning?: string;
  aggregatedGreeks?: AggregatedGreeks;
  positions: PositionSummary[];
}

export interface PortfolioExposure {
  underlyings: UnderlyingExposure[];
  totalNotionalExposure: number;
  totalRisk: number;
  totalRiskPercent: number;
  underlyingCount: number;
  exceedingLimitCount: number;
  calculatedAt: Date;
  concentrationLimit?: number;
}

// ============================================================================
// Portfolio Greeks Types
// ============================================================================

export interface PortfolioGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  positionsWithGreeks: number;
  positionsWithoutGreeks: number;
  totalOptionPositions: number;
  calculatedAt: Date;
}
