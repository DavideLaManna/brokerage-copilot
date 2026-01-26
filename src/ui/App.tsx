import React, { useState, useCallback } from 'react';
import { AccountSummary, PositionsTable, OrdersTable } from './components';
import type {
  AccountSummary as AccountSummaryType,
  Position,
  Order,
  ConnectionState,
} from './types';

// Mock data for demonstration
// In production, this would come from the API/backend
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
  brokerName: 'Tradier',
  accountId: 'VA12345678',
  lastUpdated: new Date(),
};

export default function App(): React.ReactElement {
  const [accountSummary, setAccountSummary] = useState<AccountSummaryType | null>(mockAccountSummary);
  const [positions, setPositions] = useState<Position[]>(mockPositions);
  const [orders, setOrders] = useState<Order[]>(mockOrders);
  const [connection] = useState<ConnectionState>(mockConnectionState);
  const [loading, setLoading] = useState(false);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setAccountSummary({ ...mockAccountSummary, asOf: new Date() });
      setPositions([...mockPositions]);
      setOrders([...mockOrders]);
      setLoading(false);
    }, 500);
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Options Trading Copilot</h1>
          <p className="dashboard-subtitle">
            Portfolio overview and trade management
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

      <div className="dashboard-grid">
        <AccountSummary data={accountSummary} loading={loading} />

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
