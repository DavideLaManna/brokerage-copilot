/**
 * Portfolio Snapshot Tool
 *
 * MCP tool that retrieves a comprehensive portfolio snapshot for LLM analysis.
 * Returns positions, orders, account summary, exposure, and Greeks as structured JSON.
 */

import type { BrokerAdapter, Position, Order, AccountSummary } from '../types/broker.js';
import type { RiskConfig } from '../types/risk-config.js';
import { DEFAULT_RISK_CONFIG } from '../types/risk-config.js';
import { calculatePortfolioExposure, type PortfolioExposure } from '../services/exposure-calculator.js';
import { calculatePortfolioGreeks, getGreeksInterpretation, type PortfolioGreeks } from '../services/portfolio-greeks.js';
import type {
  MCPToolDefinition,
  MCPToolResult,
  PortfolioSnapshot,
  SnapshotPosition,
  SnapshotOrder,
  SnapshotAccountSummary,
  SnapshotExposure,
  SnapshotGreeks,
  GetPortfolioSnapshotInput,
} from './types.js';
import { GetPortfolioSnapshotInputSchema } from './types.js';

// ============================================================================
// Portfolio Snapshot Builder
// ============================================================================

/**
 * Calculate days to expiration from a date
 */
function calculateDTE(expiration: Date): number {
  const now = new Date();
  const expDate = new Date(expiration);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((expDate.getTime() - now.getTime()) / msPerDay));
}

/**
 * Convert a Position to SnapshotPosition format
 */
function toSnapshotPosition(position: Position): SnapshotPosition {
  const underlying =
    position.assetClass === 'option' && position.optionDetails
      ? position.optionDetails.underlying
      : position.symbol;

  const result: SnapshotPosition = {
    id: position.id,
    symbol: position.symbol,
    underlying,
    assetClass: position.assetClass,
    quantity: position.quantity,
    averageCost: position.averageCost,
    currentPrice: position.currentPrice,
    marketValue: position.marketValue,
    unrealizedPnL: position.unrealizedPnL,
    unrealizedPnLPercent: position.unrealizedPnLPercent,
  };

  if (position.assetClass === 'option' && position.optionDetails) {
    result.optionDetails = {
      strike: position.optionDetails.strike,
      expiration: position.optionDetails.expiration.toISOString(),
      optionType: position.optionDetails.optionType,
      daysToExpiration: calculateDTE(position.optionDetails.expiration),
    };

    if (position.optionDetails.greeks) {
      result.greeks = {
        delta: position.optionDetails.greeks.delta,
        gamma: position.optionDetails.greeks.gamma,
        theta: position.optionDetails.greeks.theta,
        vega: position.optionDetails.greeks.vega,
        impliedVolatility: position.optionDetails.greeks.impliedVolatility,
      };
    }
  }

  return result;
}

/**
 * Convert an Order to SnapshotOrder format
 */
function toSnapshotOrder(order: Order): SnapshotOrder {
  const underlying =
    order.assetClass === 'option' && order.optionDetails
      ? order.optionDetails.underlying
      : order.symbol;

  const result: SnapshotOrder = {
    id: order.id,
    symbol: order.symbol,
    underlying,
    assetClass: order.assetClass,
    side: order.side,
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    quantity: order.quantity,
    filledQuantity: order.filledQuantity,
    status: order.status,
    submittedAt: order.submittedAt.toISOString(),
  };

  if (order.limitPrice !== undefined) {
    result.limitPrice = order.limitPrice;
  }

  if (order.stopPrice !== undefined) {
    result.stopPrice = order.stopPrice;
  }

  if (order.assetClass === 'option' && order.optionDetails) {
    result.optionDetails = {
      strike: order.optionDetails.strike,
      expiration: order.optionDetails.expiration.toISOString(),
      optionType: order.optionDetails.optionType,
    };
  }

  return result;
}

/**
 * Convert AccountSummary to SnapshotAccountSummary format
 */
function toSnapshotAccountSummary(account: AccountSummary): SnapshotAccountSummary {
  return {
    netLiquidation: account.netLiquidation,
    buyingPower: account.buyingPower,
    cash: account.cash,
    dailyPnL: account.dailyPnL,
    unrealizedPnL: account.unrealizedPnL,
    currency: account.currency,
  };
}

/**
 * Convert PortfolioExposure to SnapshotExposure array
 */
function toSnapshotExposures(exposure: PortfolioExposure): SnapshotExposure[] {
  return exposure.underlyings.map((u) => ({
    symbol: u.symbol,
    positionCount: u.positionCount,
    netQuantity: u.netQuantity,
    marketValue: u.marketValue,
    notionalExposure: u.notionalExposure,
    risk: u.risk,
    riskPercent: u.riskPercent,
    exceedsLimit: u.exceedsLimit,
    greeks: u.aggregatedGreeks
      ? {
          delta: u.aggregatedGreeks.delta,
          gamma: u.aggregatedGreeks.gamma,
          theta: u.aggregatedGreeks.theta,
          vega: u.aggregatedGreeks.vega,
        }
      : undefined,
  }));
}

/**
 * Convert PortfolioGreeks to SnapshotGreeks format
 */
function toSnapshotGreeks(greeks: PortfolioGreeks): SnapshotGreeks {
  return {
    delta: greeks.delta,
    gamma: greeks.gamma,
    theta: greeks.theta,
    vega: greeks.vega,
    positionsWithGreeks: greeks.positionsWithGreeks,
    positionsWithoutGreeks: greeks.positionsWithoutGreeks,
    interpretations: getGreeksInterpretation(greeks),
  };
}

/**
 * Build a complete portfolio snapshot
 */
export async function buildPortfolioSnapshot(
  adapter: BrokerAdapter,
  options?: GetPortfolioSnapshotInput
): Promise<PortfolioSnapshot> {
  const startTime = new Date();

  // Fetch all data in parallel
  const [account, positions, orders] = await Promise.all([
    adapter.getAccountSummary(),
    adapter.getPositions(),
    adapter.getOpenOrders(),
  ]);

  // Build risk config with optional concentration limit override
  const riskConfig: RiskConfig = options?.concentrationLimit
    ? { ...DEFAULT_RISK_CONFIG, maxRiskPerUnderlyingPercent: options.concentrationLimit }
    : DEFAULT_RISK_CONFIG;

  // Calculate derived data
  const exposure = calculatePortfolioExposure(positions, account, riskConfig);
  const greeks = calculatePortfolioGreeks(positions);

  // Convert to snapshot format
  const snapshotPositions = positions.map(toSnapshotPosition);
  const snapshotOrders = orders.map(toSnapshotOrder);
  const snapshotAccount = toSnapshotAccountSummary(account);
  const snapshotExposures = toSnapshotExposures(exposure);
  const snapshotGreeks = toSnapshotGreeks(greeks);

  // Count position types
  const optionPositions = positions.filter((p) => p.assetClass === 'option').length;
  const equityPositions = positions.filter((p) => p.assetClass === 'equity').length;

  // Calculate totals
  const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);

  const snapshot: PortfolioSnapshot = {
    account: snapshotAccount,
    positions: snapshotPositions,
    orders: snapshotOrders,
    exposureByUnderlying: snapshotExposures,
    portfolioGreeks: snapshotGreeks,
    summary: {
      totalPositions: positions.length,
      optionPositions,
      equityPositions,
      openOrders: orders.length,
      totalMarketValue,
      totalUnrealizedPnL,
      totalRisk: exposure.totalRisk,
      totalRiskPercent: exposure.totalRiskPercent,
      underlyingsExceedingLimit: exposure.exceedingLimitCount,
    },
    dataTimestamp: startTime.toISOString(),
    dataSources: [
      {
        source: `${adapter.brokerName} (${adapter.brokerType})`,
        retrievedAt: startTime.toISOString(),
      },
    ],
  };

  return snapshot;
}

// ============================================================================
// MCP Tool Definition
// ============================================================================

/**
 * Context required for portfolio snapshot tool
 */
export interface PortfolioSnapshotToolContext {
  /** Broker adapter for fetching data */
  adapter: BrokerAdapter | null;
}

/**
 * Create the get_portfolio_snapshot tool definition
 *
 * @param context - Tool context with dependencies
 * @returns MCP tool definition
 */
export function createPortfolioSnapshotTool(
  context: PortfolioSnapshotToolContext
): MCPToolDefinition {
  return {
    name: 'get_portfolio_snapshot',
    description: `Retrieve a comprehensive portfolio snapshot including:
- Account summary (balance, buying power, P&L)
- All positions with symbol, quantity, cost, mark price, P&L, and Greeks
- Open orders with details
- Exposure by underlying with concentration analysis
- Aggregated portfolio Greeks with interpretations

Use this tool to analyze the current portfolio state before making recommendations.`,
    inputSchema: GetPortfolioSnapshotInputSchema,
    handler: async (input: unknown): Promise<MCPToolResult> => {
      const startTime = new Date();

      // Check if connected to broker
      if (!context.adapter) {
        return {
          success: false,
          error: 'Not connected to broker. Please establish a connection first.',
          timestamp: startTime.toISOString(),
        };
      }

      try {
        // Parse and validate input (allow undefined/null input)
        const parsedInput = input === undefined || input === null ? {} : input;
        const options = GetPortfolioSnapshotInputSchema.parse(parsedInput);

        // Build the snapshot
        const snapshot = await buildPortfolioSnapshot(context.adapter, options);

        return {
          success: true,
          data: snapshot,
          timestamp: startTime.toISOString(),
          metadata: {
            positionCount: snapshot.summary.totalPositions,
            orderCount: snapshot.summary.openOrders,
            underlyingCount: snapshot.exposureByUnderlying.length,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          success: false,
          error: `Failed to retrieve portfolio snapshot: ${errorMessage}`,
          timestamp: startTime.toISOString(),
        };
      }
    },
  };
}

/**
 * Standalone function to get portfolio snapshot (for direct API use)
 *
 * @param adapter - Broker adapter
 * @param options - Optional parameters
 * @returns Portfolio snapshot
 */
export async function getPortfolioSnapshot(
  adapter: BrokerAdapter,
  options?: GetPortfolioSnapshotInput
): Promise<PortfolioSnapshot> {
  return buildPortfolioSnapshot(adapter, options);
}
