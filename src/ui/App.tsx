import React, { useState, useCallback, useEffect } from 'react';
import {
  AccountSummary,
  PositionsTable,
  OrdersTable,
  ExposurePanel,
  GreeksPanel,
  ChatPanel,
  OrderApprovalModal,
  ExecutionResultModal,
  DecisionJournal,
  ExitLadderModal,
  KillSwitchButton,
  type OrderApprovalData,
  type ExitLadderProposal,
  type KillSwitchStatusData,
  type KillSwitchActivationResult,
  type KillSwitchDeactivationResult,
} from './components';
import {
  api,
  ApiError,
  type OrderExecutionResponse,
  type OrderValidationResponse,
} from './services';
import type {
  AccountSummary as AccountSummaryType,
  Position,
  Order,
  ConnectionState,
  PortfolioExposure,
  UnderlyingExposure,
  PositionSummary,
  PortfolioGreeks,
} from './types';

// Demo mode flag - set to true to use mock data instead of API
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Default concentration limit for exposure warnings
const DEFAULT_CONCENTRATION_LIMIT = 10;

/**
 * Helper function to compute portfolio exposure on the client side (for demo mode)
 */
function computeExposure(
  positions: Position[],
  account: AccountSummaryType | null,
  concentrationLimit: number = DEFAULT_CONCENTRATION_LIMIT
): PortfolioExposure | null {
  if (!account || positions.length === 0) return null;

  const accountValue = account.netLiquidation;
  if (accountValue <= 0) return null;

  // Group positions by underlying
  const byUnderlying = new Map<string, Position[]>();
  for (const pos of positions) {
    const underlying = pos.optionDetails?.underlying || pos.symbol;
    if (!byUnderlying.has(underlying)) {
      byUnderlying.set(underlying, []);
    }
    byUnderlying.get(underlying)!.push(pos);
  }

  let totalNotional = 0;
  let totalRisk = 0;
  let exceedingCount = 0;
  const underlyings: UnderlyingExposure[] = [];

  for (const [symbol, underlyingPositions] of byUnderlying) {
    let notional = 0;
    let risk = 0;
    let marketValue = 0;
    let unrealizedPnL = 0;
    let netQty = 0;
    const positionSummaries: PositionSummary[] = [];

    for (const pos of underlyingPositions) {
      marketValue += pos.marketValue;
      unrealizedPnL += pos.unrealizedPnL;

      let posNotional: number;
      let posRisk: number;

      if (pos.assetClass === 'option' && pos.optionDetails) {
        const strike = pos.optionDetails.strike;
        const multiplier = pos.optionDetails.multiplier;
        const contracts = Math.abs(pos.quantity);
        posNotional = contracts * strike * multiplier;

        // Risk calculation
        if (pos.quantity > 0) {
          posRisk = Math.abs(pos.marketValue);
        } else {
          if (pos.optionDetails.optionType === 'put') {
            posRisk = strike * multiplier * contracts;
          } else {
            posRisk = strike * multiplier * contracts * 3; // Proxy for short calls
          }
        }

        // Delta-equivalent shares
        const delta = pos.optionDetails.greeks?.delta ?? 0;
        netQty += pos.quantity * delta * multiplier;
      } else {
        posNotional = Math.abs(pos.quantity * pos.currentPrice);
        posRisk = pos.quantity > 0 ? Math.abs(pos.marketValue) : Math.abs(pos.marketValue) * 2;
        netQty += pos.quantity;
      }

      notional += posNotional;
      risk += posRisk;

      const msPerDay = 24 * 60 * 60 * 1000;
      const dte = pos.optionDetails
        ? Math.max(0, Math.floor((new Date(pos.optionDetails.expiration).getTime() - Date.now()) / msPerDay))
        : undefined;

      positionSummaries.push({
        id: pos.id,
        symbol: pos.symbol,
        assetClass: pos.assetClass,
        quantity: pos.quantity,
        marketValue: pos.marketValue,
        notionalExposure: posNotional,
        risk: posRisk,
        optionType: pos.optionDetails?.optionType,
        strike: pos.optionDetails?.strike,
        dte,
      });
    }

    const riskPercent = (risk / accountValue) * 100;
    const exceedsLimit = riskPercent > concentrationLimit;
    if (exceedsLimit) exceedingCount++;

    underlyings.push({
      symbol,
      notionalExposure: notional,
      risk,
      exposurePercent: (notional / accountValue) * 100,
      riskPercent,
      positionCount: underlyingPositions.length,
      netQuantity: Math.round(netQty * 100) / 100,
      marketValue,
      unrealizedPnL,
      exceedsLimit,
      warning: exceedsLimit
        ? `${symbol} exposure (${riskPercent.toFixed(1)}%) exceeds ${concentrationLimit}% concentration limit`
        : undefined,
      positions: positionSummaries,
    });

    totalNotional += notional;
    totalRisk += risk;
  }

  // Sort by exposure descending
  underlyings.sort((a, b) => b.exposurePercent - a.exposurePercent);

  return {
    underlyings,
    totalNotionalExposure: totalNotional,
    totalRisk,
    totalRiskPercent: (totalRisk / accountValue) * 100,
    underlyingCount: underlyings.length,
    exceedingLimitCount: exceedingCount,
    calculatedAt: new Date(),
    concentrationLimit,
  };
}

/**
 * Helper function to compute portfolio Greeks on the client side (for demo mode)
 */
function computeGreeks(positions: Position[]): PortfolioGreeks | null {
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  let positionsWithGreeks = 0;
  let positionsWithoutGreeks = 0;
  let totalOptionPositions = 0;

  for (const pos of positions) {
    if (pos.assetClass !== 'option' || !pos.optionDetails) {
      continue;
    }

    totalOptionPositions++;
    const greeks = pos.optionDetails.greeks;
    const multiplier = pos.optionDetails.multiplier;
    const quantity = pos.quantity;

    if (!greeks || (greeks.delta === undefined && greeks.gamma === undefined &&
        greeks.theta === undefined && greeks.vega === undefined)) {
      positionsWithoutGreeks++;
      continue;
    }

    positionsWithGreeks++;

    if (greeks.delta !== undefined) {
      delta += greeks.delta * quantity * multiplier;
    }
    if (greeks.gamma !== undefined) {
      gamma += greeks.gamma * quantity * multiplier;
    }
    if (greeks.theta !== undefined) {
      theta += greeks.theta * quantity * multiplier;
    }
    if (greeks.vega !== undefined) {
      vega += greeks.vega * quantity * multiplier;
    }
  }

  if (totalOptionPositions === 0) {
    return null;
  }

  return {
    delta: Math.round(delta * 100) / 100,
    gamma: Math.round(gamma * 100) / 100,
    theta: Math.round(theta * 100) / 100,
    vega: Math.round(vega * 100) / 100,
    positionsWithGreeks,
    positionsWithoutGreeks,
    totalOptionPositions,
    calculatedAt: new Date(),
  };
}

// Mock data for demonstration/offline mode
const mockAccountSummary: AccountSummaryType = {
  netLiquidation: 125432.87,
  buyingPower: 98234.56,
  cash: 45123.45,
  dailyPnL: 1234.56,
  unrealizedPnL: -567.89,
  currency: 'USD',
  asOf: new Date(),
};

const mockPositions: Position[] = [
  {
    id: 'pos-1',
    symbol: 'AAPL240216C00185000',
    quantity: 5,
    averageCost: 4.25,
    currentPrice: 5.80,
    marketValue: 2900.00,
    unrealizedPnL: 775.00,
    unrealizedPnLPercent: 36.47,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'AAPL240216C00185000',
      underlying: 'AAPL',
      strike: 185,
      expiration: new Date('2024-02-16'),
      optionType: 'call',
      multiplier: 100,
      greeks: {
        delta: 0.65,
        gamma: 0.08,
        theta: -0.15,
        vega: 0.25,
        impliedVolatility: 0.28,
      },
    },
  },
  {
    id: 'pos-2',
    symbol: 'SPY240315P00475000',
    quantity: -3,
    averageCost: 3.50,
    currentPrice: 2.85,
    marketValue: -855.00,
    unrealizedPnL: 195.00,
    unrealizedPnLPercent: 18.57,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'SPY240315P00475000',
      underlying: 'SPY',
      strike: 475,
      expiration: new Date('2024-03-15'),
      optionType: 'put',
      multiplier: 100,
      greeks: {
        delta: -0.32,
        gamma: 0.04,
        theta: -0.08,
        vega: 0.18,
        impliedVolatility: 0.22,
      },
    },
  },
  {
    id: 'pos-3',
    symbol: 'NVDA',
    quantity: 50,
    averageCost: 485.00,
    currentPrice: 512.50,
    marketValue: 25625.00,
    unrealizedPnL: 1375.00,
    unrealizedPnLPercent: 5.67,
    assetClass: 'equity',
  },
  {
    id: 'pos-4',
    symbol: 'TSLA240301C00250000',
    quantity: 2,
    averageCost: 8.75,
    currentPrice: 6.20,
    marketValue: 1240.00,
    unrealizedPnL: -510.00,
    unrealizedPnLPercent: -29.14,
    assetClass: 'option',
    optionDetails: {
      optionSymbol: 'TSLA240301C00250000',
      underlying: 'TSLA',
      strike: 250,
      expiration: new Date('2024-03-01'),
      optionType: 'call',
      multiplier: 100,
      greeks: {
        delta: 0.42,
        gamma: 0.06,
        theta: -0.22,
        vega: 0.35,
        impliedVolatility: 0.55,
      },
    },
  },
];

const mockOrders: Order[] = [
  {
    id: 'ord-1',
    symbol: 'AAPL240216C00190000',
    assetClass: 'option',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'day',
    quantity: 3,
    limitPrice: 3.25,
    filledQuantity: 0,
    status: 'open',
    submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    optionDetails: {
      optionSymbol: 'AAPL240216C00190000',
      underlying: 'AAPL',
      strike: 190,
      expiration: new Date('2024-02-16'),
      optionType: 'call',
      multiplier: 100,
    },
  },
  {
    id: 'ord-2',
    symbol: 'SPY240315P00470000',
    assetClass: 'option',
    side: 'sell',
    orderType: 'limit',
    timeInForce: 'gtc',
    quantity: 5,
    limitPrice: 4.50,
    filledQuantity: 2,
    status: 'partially_filled',
    submittedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    optionDetails: {
      optionSymbol: 'SPY240315P00470000',
      underlying: 'SPY',
      strike: 470,
      expiration: new Date('2024-03-15'),
      optionType: 'put',
      multiplier: 100,
    },
  },
];

const mockConnectionState: ConnectionState = {
  connected: true,
  brokerName: 'Tradier (Demo)',
  accountId: 'DEMO123456',
  lastUpdated: new Date(),
};

export default function App(): React.ReactElement {
  const [accountSummary, setAccountSummary] = useState<AccountSummaryType | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [exposure, setExposure] = useState<PortfolioExposure | null>(null);
  const [greeks, setGreeks] = useState<PortfolioGreeks | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
    brokerName: 'Unknown',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Order execution flow state
  const [orderApprovalData, setOrderApprovalData] = useState<OrderApprovalData | null>(null);
  const [orderValidationResponse, setOrderValidationResponse] = useState<OrderValidationResponse | null>(null);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [executionResult, setExecutionResult] = useState<OrderExecutionResponse | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  // Exit ladder modal state
  const [exitLadderPosition, setExitLadderPosition] = useState<Position | null>(null);
  const [isExitLadderModalOpen, setIsExitLadderModalOpen] = useState(false);
  const [isExitLadderSubmitting, setIsExitLadderSubmitting] = useState(false);

  // Kill switch state
  const [killSwitchStatus, setKillSwitchStatus] = useState<KillSwitchStatusData>({
    state: 'inactive',
    readOnlyMode: false,
    config: {
      cancelOrdersOnActivation: false,
      disableAutoRepriceOnActivation: true,
      disableAlertsOnActivation: true,
      reEnableCooldownSeconds: 30,
      requireConfirmationForReEnable: true,
    },
  });
  const [killSwitchLoading, setKillSwitchLoading] = useState(false);

  /**
   * Fetch portfolio data from API or use mock data
   */
  const fetchPortfolio = useCallback(async () => {
    if (DEMO_MODE) {
      // Use mock data in demo mode
      const mockAccount = { ...mockAccountSummary, asOf: new Date() };
      const mockPos = [...mockPositions];
      setAccountSummary(mockAccount);
      setPositions(mockPos);
      setOrders([...mockOrders]);
      setConnection({ ...mockConnectionState, lastUpdated: new Date() });
      // Compute exposure and Greeks locally for demo mode
      setExposure(computeExposure(mockPos, mockAccount));
      setGreeks(computeGreeks(mockPos));
      setError(null);
      return;
    }

    try {
      const portfolio = await api.getPortfolio();
      setAccountSummary(portfolio.account);
      setPositions(portfolio.positions);
      setOrders(portfolio.orders);

      if (portfolio.connected) {
        const connectionInfo = await api.getConnection();
        setConnection(connectionInfo);
        // Fetch exposure and Greeks from API
        try {
          const exposureData = await api.getExposure();
          setExposure(exposureData);
        } catch {
          // Compute locally if API fails
          setExposure(computeExposure(portfolio.positions, portfolio.account));
        }
        try {
          const greeksData = await api.getGreeks();
          setGreeks(greeksData);
        } catch {
          // Compute locally if API fails
          setGreeks(computeGreeks(portfolio.positions));
        }
      } else {
        setConnection({
          connected: false,
          brokerName: 'Not connected',
        });
        setExposure(null);
        setGreeks(null);
      }
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 503) {
          setError('Not connected to broker. Please connect first.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to connect to API server. Is it running?');
      }
      // Keep existing data if any
    }
  }, []);

  /**
   * Handle refresh button click
   */
  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      if (DEMO_MODE) {
        // Simulate API delay in demo mode
        await new Promise((resolve) => setTimeout(resolve, 500));
        const mockAccount = { ...mockAccountSummary, asOf: new Date() };
        const mockPos = [...mockPositions];
        setAccountSummary(mockAccount);
        setPositions(mockPos);
        setOrders([...mockOrders]);
        setExposure(computeExposure(mockPos, mockAccount));
        setGreeks(computeGreeks(mockPos));
        setError(null);
      } else {
        const portfolio = await api.refresh();
        setAccountSummary(portfolio.account);
        setPositions(portfolio.positions);
        setOrders(portfolio.orders);
        // Refresh exposure and Greeks data
        try {
          const exposureData = await api.getExposure();
          setExposure(exposureData);
        } catch {
          setExposure(computeExposure(portfolio.positions, portfolio.account));
        }
        try {
          const greeksData = await api.getGreeks();
          setGreeks(greeksData);
        } catch {
          setGreeks(computeGreeks(portfolio.positions));
        }
        setError(null);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to refresh data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Handle order approval (from OrderApprovalModal)
   * This triggers the full execution flow: validation → submission → confirmation
   */
  const handleOrderApproval = useCallback(async (proposalId?: string) => {
    if (!orderValidationResponse || DEMO_MODE) {
      // In demo mode, simulate success
      if (DEMO_MODE) {
        const mockResult: OrderExecutionResponse = {
          success: true,
          status: 'executed',
          proposalId,
          correlationId: orderValidationResponse?.correlationId || 'demo-correlation-id',
          orderResults: [
            {
              success: true,
              idempotencyKey: 'demo-key-1',
              orderId: 'DEMO-ORDER-123456',
              retryCount: 0,
            },
          ],
          summary: { total: 1, succeeded: 1, failed: 0 },
          brokerOrderIds: ['DEMO-ORDER-123456'],
          executedAt: new Date().toISOString(),
        };
        setExecutionResult(mockResult);
        setIsApprovalModalOpen(false);
        setIsResultModalOpen(true);
      }
      return;
    }

    setIsApproving(true);

    try {
      // Build execution request from validation response
      const executionRequest = {
        orders: orderValidationResponse.orders.map((order, idx) => ({
          orderRequest: {
            symbol: `${order.underlying}${order.expiration.slice(2, 10).replace(/-/g, '')}${order.optionType === 'call' ? 'C' : 'P'}${String(order.strike * 1000).padStart(8, '0')}`,
            side: order.side,
            quantity: order.quantity,
            orderType: 'limit' as const,
            limitPrice: order.limitPrice,
            timeInForce: 'day' as const,
            optionDetails: {
              underlying: order.underlying,
              strike: order.strike,
              expiration: order.expiration,
              optionType: order.optionType,
              multiplier: 100,
            },
          },
          idempotencyKey: order.idempotencyKey,
          proposalId,
          legIndex: idx,
          contractInfo: {
            underlying: order.underlying,
            strike: order.strike,
            expiration: order.expiration,
            optionType: order.optionType,
            side: order.side,
            quantity: order.quantity,
            targetPrice: order.limitPrice,
          },
          estimatedCost: order.estimatedCost,
        })),
        correlationId: orderValidationResponse.correlationId,
        proposalId,
      };

      // Execute the orders
      const result = await api.executeOrders(executionRequest);

      setExecutionResult(result);
      setIsApprovalModalOpen(false);
      setIsResultModalOpen(true);

      // If successful, refresh portfolio data
      if (result.success) {
        // Delay refresh slightly to allow broker to update
        setTimeout(handleRefresh, 1000);
      }
    } catch (err) {
      // Handle execution error
      const errorMessage = err instanceof ApiError ? err.message : 'Failed to execute order';
      setExecutionResult({
        success: false,
        status: 'failed',
        proposalId,
        correlationId: orderValidationResponse.correlationId,
        orderResults: [],
        summary: { total: orderValidationResponse.orders.length, succeeded: 0, failed: orderValidationResponse.orders.length },
        brokerOrderIds: [],
        errorMessage,
        executedAt: new Date().toISOString(),
      });
      setIsApprovalModalOpen(false);
      setIsResultModalOpen(true);
    } finally {
      setIsApproving(false);
    }
  }, [orderValidationResponse, handleRefresh]);

  /**
   * Handle order rejection (from OrderApprovalModal)
   */
  const handleOrderRejection = useCallback((proposalId?: string, reason?: string) => {
    console.log('Order rejected:', { proposalId, reason });
    setIsApprovalModalOpen(false);
    setOrderApprovalData(null);
    setOrderValidationResponse(null);
  }, []);

  /**
   * Close approval modal
   */
  const handleApprovalModalClose = useCallback(() => {
    if (!isApproving) {
      setIsApprovalModalOpen(false);
      setOrderApprovalData(null);
      setOrderValidationResponse(null);
    }
  }, [isApproving]);

  /**
   * Close execution result modal
   */
  const handleResultModalClose = useCallback(() => {
    setIsResultModalOpen(false);
    setExecutionResult(null);
    setOrderApprovalData(null);
    setOrderValidationResponse(null);
  }, []);

  /**
   * Handle order cancellation
   * Returns success status and optional message
   */
  const handleCancelOrder = useCallback(async (orderId: string): Promise<{ success: boolean; message?: string }> => {
    if (DEMO_MODE) {
      // Simulate cancellation in demo mode
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log('[ORDER CANCEL] Demo mode - simulating order cancellation:', orderId);
      // Remove the order from state in demo mode
      setOrders((prevOrders) => prevOrders.filter((o) => o.id !== orderId));
      return { success: true, message: `Order ${orderId} has been canceled` };
    }

    try {
      const result = await api.cancelOrder(orderId);
      console.log('[ORDER CANCEL] Order canceled successfully:', result);
      // Refresh orders list after successful cancellation
      await handleRefresh();
      return { success: true, message: result.message };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to cancel order';
      console.error('[ORDER CANCEL] Failed to cancel order:', message);
      return { success: false, message };
    }
  }, [handleRefresh]);

  /**
   * Handle opening exit ladder modal for a position
   */
  const handleSetExitLadder = useCallback((position: Position) => {
    setExitLadderPosition(position);
    setIsExitLadderModalOpen(true);
  }, []);

  /**
   * Handle exit ladder modal close
   */
  const handleExitLadderModalClose = useCallback(() => {
    if (!isExitLadderSubmitting) {
      setIsExitLadderModalOpen(false);
      setExitLadderPosition(null);
    }
  }, [isExitLadderSubmitting]);

  /**
   * Handle exit ladder approval
   * Submits all exit ladder orders to the broker
   */
  const handleExitLadderApprove = useCallback(async (proposal: ExitLadderProposal) => {
    if (!exitLadderPosition) return;

    setIsExitLadderSubmitting(true);

    try {
      if (DEMO_MODE) {
        // Simulate submission in demo mode
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log('[EXIT LADDER] Demo mode - simulated submission:', {
          proposalId: proposal.proposalId,
          orders: proposal.orders.length,
        });
        setIsExitLadderModalOpen(false);
        setExitLadderPosition(null);
        // Refresh data
        await handleRefresh();
      } else {
        // Real API call to submit exit ladder
        const response = await fetch('/api/exit-ladder/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposalId: proposal.proposalId,
            positionId: exitLadderPosition.id,
            rungs: proposal.config.rungs,
          }),
        });

        const json = await response.json();

        if (!json.success) {
          throw new Error(json.error || 'Failed to submit exit ladder');
        }

        console.log('[EXIT LADDER] Successfully submitted exit ladder orders:', {
          proposalId: proposal.proposalId,
          correlationId: json.data.correlationId,
          orderCount: json.data.orderResults?.length || 0,
        });

        setIsExitLadderModalOpen(false);
        setExitLadderPosition(null);

        // Refresh data to show new orders
        setTimeout(handleRefresh, 1000);
      }
    } catch (err) {
      console.error('[EXIT LADDER] Error submitting exit ladder:', err);
      // Keep modal open so user can try again
    } finally {
      setIsExitLadderSubmitting(false);
    }
  }, [exitLadderPosition, handleRefresh]);

  /**
   * Fetch kill switch status from API
   */
  const fetchKillSwitchStatus = useCallback(async () => {
    if (DEMO_MODE) {
      // Use local state in demo mode
      return;
    }

    try {
      const status = await api.getKillSwitchStatus();
      setKillSwitchStatus(status);
    } catch (err) {
      console.error('[KILL SWITCH] Error fetching status:', err);
    }
  }, []);

  /**
   * Handle kill switch activation
   */
  const handleKillSwitchActivate = useCallback(async (
    reason?: string,
    cancelOrders?: boolean
  ): Promise<KillSwitchActivationResult> => {
    setKillSwitchLoading(true);

    if (DEMO_MODE) {
      // Simulate activation in demo mode
      await new Promise((resolve) => setTimeout(resolve, 500));
      const activatedAt = new Date().toISOString();
      const newStatus: KillSwitchStatusData = {
        ...killSwitchStatus,
        state: 'active',
        readOnlyMode: true,
        activatedAt,
        activatedBy: 'user',
        reason,
        reasonCategory: 'manual',
        ordersCancelled: cancelOrders ? orders.length : 0,
        cancelledOrderIds: cancelOrders ? orders.map(o => o.id) : [],
        disabledFeatures: ['auto_reprice', 'alert_monitoring'],
        canReEnableAt: new Date(Date.now() + 30000).toISOString(),
      };
      setKillSwitchStatus(newStatus);
      setKillSwitchLoading(false);

      return {
        success: true,
        status: newStatus,
        ordersCancelled: cancelOrders ? orders.map(o => ({
          orderId: o.id,
          symbol: o.symbol,
          side: o.side,
          quantity: o.quantity,
          success: true,
        })) : [],
        featuresDisabled: ['auto_reprice', 'alert_monitoring'],
        activatedAt,
      };
    }

    try {
      const result = await api.activateKillSwitch(reason, cancelOrders, 'manual');
      setKillSwitchStatus(result.status);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        status: killSwitchStatus,
        ordersCancelled: [],
        featuresDisabled: [],
        error,
        activatedAt: new Date().toISOString(),
      };
    } finally {
      setKillSwitchLoading(false);
    }
  }, [killSwitchStatus, orders]);

  /**
   * Handle kill switch deactivation
   */
  const handleKillSwitchDeactivate = useCallback(async (
    confirmed: boolean
  ): Promise<KillSwitchDeactivationResult> => {
    setKillSwitchLoading(true);

    if (DEMO_MODE) {
      // Simulate deactivation in demo mode
      await new Promise((resolve) => setTimeout(resolve, 500));
      const deactivatedAt = new Date().toISOString();

      // Check cooldown
      if (killSwitchStatus.canReEnableAt) {
        const cooldownEnd = new Date(killSwitchStatus.canReEnableAt).getTime();
        if (Date.now() < cooldownEnd) {
          const remainingSeconds = Math.ceil((cooldownEnd - Date.now()) / 1000);
          setKillSwitchLoading(false);
          return {
            success: false,
            status: killSwitchStatus,
            featuresReEnabled: [],
            error: `Cannot re-enable yet. Cooldown remaining: ${remainingSeconds} seconds`,
            deactivatedAt,
          };
        }
      }

      // Check confirmation
      if (!confirmed && killSwitchStatus.config.requireConfirmationForReEnable) {
        setKillSwitchLoading(false);
        return {
          success: false,
          status: killSwitchStatus,
          featuresReEnabled: [],
          error: 'User confirmation required to re-enable the system',
          deactivatedAt,
        };
      }

      const newStatus: KillSwitchStatusData = {
        state: 'inactive',
        readOnlyMode: false,
        config: killSwitchStatus.config,
      };
      setKillSwitchStatus(newStatus);
      setKillSwitchLoading(false);

      return {
        success: true,
        status: newStatus,
        featuresReEnabled: killSwitchStatus.disabledFeatures || [],
        deactivatedAt,
      };
    }

    try {
      const result = await api.deactivateKillSwitch(confirmed);
      setKillSwitchStatus(result.status);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return {
        success: false,
        status: killSwitchStatus,
        featuresReEnabled: [],
        error,
        deactivatedAt: new Date().toISOString(),
      };
    } finally {
      setKillSwitchLoading(false);
    }
  }, [killSwitchStatus]);

  /**
   * Initial data load
   */
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await fetchPortfolio();
      await fetchKillSwitchStatus();
      setLoading(false);
    };
    loadData();
  }, [fetchPortfolio, fetchKillSwitchStatus]);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Options Trading Copilot</h1>
          <p className="dashboard-subtitle">
            Portfolio overview and trade management
            {DEMO_MODE && <span className="demo-badge"> (Demo Mode)</span>}
          </p>
        </div>
        <div className="header-controls">
          <KillSwitchButton
            status={killSwitchStatus}
            onActivate={handleKillSwitchActivate}
            onDeactivate={handleKillSwitchDeactivate}
            loading={killSwitchLoading}
            compact={true}
          />
          <div className="connection-status">
            <span
              className={`connection-indicator ${
                connection.connected
                  ? 'connection-indicator--connected'
                  : 'connection-indicator--disconnected'
              }`}
            />
            <span>
              {connection.connected
                ? `Connected to ${connection.brokerName}`
                : 'Disconnected'}
            </span>
            {connection.accountId && (
              <span className="text-muted">({connection.accountId})</span>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
          <button
            className="error-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      <div className="dashboard-grid">
        <AccountSummary data={accountSummary} loading={loading} />

        <GreeksPanel
          greeks={greeks}
          loading={loading}
          onRefresh={handleRefresh}
        />

        <ExposurePanel
          exposure={exposure}
          concentrationLimit={exposure?.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT}
          loading={loading}
          onRefresh={handleRefresh}
        />

        <PositionsTable
          positions={positions}
          loading={loading}
          onRefresh={handleRefresh}
          onSetExitLadder={handleSetExitLadder}
        />

        <OrdersTable
          orders={orders}
          loading={loading}
          onRefresh={handleRefresh}
          onCancelOrder={handleCancelOrder}
        />

        <ChatPanel
          demoMode={DEMO_MODE}
        />

        <DecisionJournal
          demoMode={DEMO_MODE}
        />
      </div>

      {/* Order Approval Modal */}
      {orderApprovalData && (
        <OrderApprovalModal
          data={orderApprovalData}
          isOpen={isApprovalModalOpen}
          onClose={handleApprovalModalClose}
          onApprove={handleOrderApproval}
          onReject={handleOrderRejection}
          isApproving={isApproving}
        />
      )}

      {/* Execution Result Modal */}
      <ExecutionResultModal
        result={executionResult}
        isOpen={isResultModalOpen}
        onClose={handleResultModalClose}
        onRefresh={handleRefresh}
      />

      {/* Exit Ladder Modal */}
      {exitLadderPosition && (
        <ExitLadderModal
          position={exitLadderPosition}
          isOpen={isExitLadderModalOpen}
          onClose={handleExitLadderModalClose}
          onApprove={handleExitLadderApprove}
          isSubmitting={isExitLadderSubmitting}
          demoMode={DEMO_MODE}
        />
      )}
    </div>
  );
}
