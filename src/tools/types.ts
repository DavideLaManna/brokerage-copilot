/**
 * MCP Tool Types
 *
 * Type definitions for Model Context Protocol (MCP) tool implementations.
 * These tools are used by LLM agents to interact with the trading system.
 */

import { z } from 'zod';

// ============================================================================
// MCP Tool Base Types
// ============================================================================

/**
 * MCP Tool definition for registration
 */
export interface MCPToolDefinition {
  /** Unique tool name (e.g., 'get_portfolio_snapshot') */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON schema for input parameters */
  inputSchema: z.ZodType<unknown>;
  /** Tool handler function */
  handler: (input: unknown) => Promise<MCPToolResult>;
}

/**
 * MCP Tool execution result
 */
export interface MCPToolResult {
  /** Whether the tool executed successfully */
  success: boolean;
  /** Result data (if successful) */
  data?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Timestamp of execution */
  timestamp: string;
  /** Metadata about the execution */
  metadata?: Record<string, unknown>;
}

/**
 * MCP Tool registry interface
 */
export interface MCPToolRegistry {
  /** Register a new tool */
  register(tool: MCPToolDefinition): void;
  /** Get a tool by name */
  get(name: string): MCPToolDefinition | undefined;
  /** List all registered tools */
  list(): MCPToolDefinition[];
  /** Execute a tool by name */
  execute(name: string, input: unknown): Promise<MCPToolResult>;
}

// ============================================================================
// Data Snapshot Types
// ============================================================================

/**
 * Position data for portfolio snapshot
 */
export interface SnapshotPosition {
  /** Position ID */
  id: string;
  /** Symbol (option symbol for options, ticker for equity) */
  symbol: string;
  /** Underlying symbol (same as symbol for equity) */
  underlying: string;
  /** Asset class */
  assetClass: 'equity' | 'option';
  /** Quantity (positive = long, negative = short) */
  quantity: number;
  /** Average cost basis */
  averageCost: number;
  /** Current market price */
  currentPrice: number;
  /** Current market value */
  marketValue: number;
  /** Unrealized P&L in dollars */
  unrealizedPnL: number;
  /** Unrealized P&L as percentage */
  unrealizedPnLPercent: number;
  /** Option details (if option) */
  optionDetails?: {
    strike: number;
    expiration: string;
    optionType: 'call' | 'put';
    daysToExpiration: number;
  };
  /** Greeks (if available) */
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    impliedVolatility?: number;
  };
}

/**
 * Order data for portfolio snapshot
 */
export interface SnapshotOrder {
  /** Order ID */
  id: string;
  /** Symbol */
  symbol: string;
  /** Underlying symbol */
  underlying: string;
  /** Asset class */
  assetClass: 'equity' | 'option';
  /** Order side */
  side: 'buy' | 'sell';
  /** Order type */
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit';
  /** Time in force */
  timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
  /** Order quantity */
  quantity: number;
  /** Filled quantity */
  filledQuantity: number;
  /** Limit price (if applicable) */
  limitPrice?: number;
  /** Stop price (if applicable) */
  stopPrice?: number;
  /** Order status */
  status: string;
  /** Time submitted */
  submittedAt: string;
  /** Option details (if option) */
  optionDetails?: {
    strike: number;
    expiration: string;
    optionType: 'call' | 'put';
  };
}

/**
 * Account summary for portfolio snapshot
 */
export interface SnapshotAccountSummary {
  /** Net liquidation value */
  netLiquidation: number;
  /** Available buying power */
  buyingPower: number;
  /** Cash balance */
  cash: number;
  /** Daily P&L */
  dailyPnL: number;
  /** Total unrealized P&L */
  unrealizedPnL: number;
  /** Account currency */
  currency: string;
}

/**
 * Exposure by underlying for portfolio snapshot
 */
export interface SnapshotExposure {
  /** Underlying symbol */
  symbol: string;
  /** Number of positions */
  positionCount: number;
  /** Net quantity (delta-equivalent for options) */
  netQuantity: number;
  /** Total market value */
  marketValue: number;
  /** Notional exposure */
  notionalExposure: number;
  /** Risk (max potential loss) */
  risk: number;
  /** Risk as percentage of account */
  riskPercent: number;
  /** Whether this exceeds concentration limit */
  exceedsLimit: boolean;
  /** Aggregated Greeks */
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  };
}

/**
 * Portfolio Greeks for snapshot
 */
export interface SnapshotGreeks {
  /** Total portfolio delta */
  delta: number;
  /** Total portfolio gamma */
  gamma: number;
  /** Total portfolio theta */
  theta: number;
  /** Total portfolio vega */
  vega: number;
  /** Positions with Greeks data */
  positionsWithGreeks: number;
  /** Positions missing Greeks data */
  positionsWithoutGreeks: number;
  /** Interpretation hints */
  interpretations: string[];
}

/**
 * Complete portfolio snapshot returned by get_portfolio_snapshot tool
 */
export interface PortfolioSnapshot {
  /** Account summary data */
  account: SnapshotAccountSummary;
  /** Current positions */
  positions: SnapshotPosition[];
  /** Open orders */
  orders: SnapshotOrder[];
  /** Exposure by underlying */
  exposureByUnderlying: SnapshotExposure[];
  /** Aggregated portfolio Greeks */
  portfolioGreeks: SnapshotGreeks;
  /** Summary statistics */
  summary: {
    totalPositions: number;
    optionPositions: number;
    equityPositions: number;
    openOrders: number;
    totalMarketValue: number;
    totalUnrealizedPnL: number;
    totalRisk: number;
    totalRiskPercent: number;
    underlyingsExceedingLimit: number;
  };
  /** Data timestamp */
  dataTimestamp: string;
  /** Data sources used */
  dataSources: {
    source: string;
    retrievedAt: string;
  }[];
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

/**
 * Schema for get_portfolio_snapshot input (no required parameters)
 */
export const GetPortfolioSnapshotInputSchema = z.object({
  /** Optional: include detailed position breakdown */
  includeDetailedBreakdown: z.boolean().optional(),
  /** Optional: concentration limit override (percentage) */
  concentrationLimit: z.number().min(0).max(100).optional(),
});

export type GetPortfolioSnapshotInput = z.infer<typeof GetPortfolioSnapshotInputSchema> | undefined;
