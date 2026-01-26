import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { AccountSummary, PositionsTable, OrdersTable, ExposurePanel } from './components';
import { api, ApiError } from './services';
import type {
  AccountSummary as AccountSummaryType,
  Position,
  Order,
  ConnectionState,
  PortfolioExposure,
  UnderlyingExposure,
  PositionSummary,
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
  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
    brokerName: 'Unknown',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      // Compute exposure locally for demo mode
      setExposure(computeExposure(mockPos, mockAccount));
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
        // Fetch exposure from API
        try {
          const exposureData = await api.getExposure();
          setExposure(exposureData);
        } catch {
          // Compute locally if API fails
          setExposure(computeExposure(portfolio.positions, portfolio.account));
        }
      } else {
        setConnection({
          connected: false,
          brokerName: 'Not connected',
        });
        setExposure(null);
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
        setError(null);
      } else {
        const portfolio = await api.refresh();
        setAccountSummary(portfolio.account);
        setPositions(portfolio.positions);
        setOrders(portfolio.orders);
        // Refresh exposure data
        try {
          const exposureData = await api.getExposure();
          setExposure(exposureData);
        } catch {
          setExposure(computeExposure(portfolio.positions, portfolio.account));
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
   * Initial data load
   */
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await fetchPortfolio();
      setLoading(false);
    };
    loadData();
  }, [fetchPortfolio]);

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
        />

        <OrdersTable
          orders={orders}
          loading={loading}
          onRefresh={handleRefresh}
        />
      </div>
    </div>
  );
}
