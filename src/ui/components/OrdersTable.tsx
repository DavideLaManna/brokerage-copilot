import React from 'react';
import type { Order } from '../types';

interface Props {
  orders: Order[];
  loading?: boolean;
  onRefresh?: () => void;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getContractDescription(order: Order): string {
  if (order.assetClass === 'equity') {
    return order.symbol;
  }

  const opt = order.optionDetails;
  if (!opt) {
    return order.symbol;
  }

  const expStr = formatDate(opt.expiration);
  const typeStr = opt.optionType === 'call' ? 'C' : 'P';
  return `${opt.underlying} ${expStr} $${opt.strike} ${typeStr}`;
}

function getOrderTypeLabel(order: Order): string {
  switch (order.orderType) {
    case 'market':
      return 'MKT';
    case 'limit':
      return 'LMT';
    case 'stop':
      return 'STP';
    case 'stop_limit':
      return 'STP LMT';
  }
}

export default function OrdersTable({ orders, loading, onRefresh }: Props): React.ReactElement {
  return (
    <section className="section section--full-width">
      <header className="section-header">
        <h2 className="section-title">Open Orders</h2>
        {onRefresh && (
          <button className="btn" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        )}
      </header>
      <div className="section-content">
        {loading ? (
          <div className="loading">
            <div className="loading-spinner" />
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <p className="empty-state-text">No open orders</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Contract</th>
                  <th>Side</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Limit</th>
                  <th>Status</th>
                  <th>TIF</th>
                  <th>Time Placed</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const contractDesc = getContractDescription(order);

                  return (
                    <tr key={order.id}>
                      <td className="table-mono">
                        {order.optionDetails?.underlying || order.symbol}
                      </td>
                      <td className="table-mono">{contractDesc}</td>
                      <td>
                        <span className={`badge badge--${order.side}`}>
                          {order.side}
                        </span>
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {order.filledQuantity > 0
                          ? `${order.filledQuantity}/${order.quantity}`
                          : order.quantity}
                      </td>
                      <td className="text-secondary">{getOrderTypeLabel(order)}</td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {order.limitPrice ? formatCurrency(order.limitPrice) : '—'}
                      </td>
                      <td>
                        <span className={`badge badge--${order.status}`}>
                          {order.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="text-secondary text-uppercase">
                        {order.timeInForce.toUpperCase()}
                      </td>
                      <td className="text-secondary">
                        {formatDate(order.submittedAt)} {formatTime(order.submittedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
