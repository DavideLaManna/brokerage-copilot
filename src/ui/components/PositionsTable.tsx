import React from 'react';
import type { Position } from '../types';

interface Props {
  positions: Position[];
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

function formatPercent(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return prefix + value.toFixed(2) + '%';
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

function getContractDescription(position: Position): string {
  if (position.assetClass === 'equity') {
    return position.symbol;
  }

  const opt = position.optionDetails;
  if (!opt) {
    return position.symbol;
  }

  const expStr = formatDate(opt.expiration);
  const typeStr = opt.optionType === 'call' ? 'C' : 'P';
  return `${opt.underlying} ${expStr} $${opt.strike} ${typeStr}`;
}

export default function PositionsTable({ positions, loading, onRefresh }: Props): React.ReactElement {
  return (
    <section className="section section--full-width">
      <header className="section-header">
        <h2 className="section-title">Open Positions</h2>
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
        ) : positions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p className="empty-state-text">No open positions</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Contract</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Avg Cost</th>
                  <th style={{ textAlign: 'right' }}>Mark</th>
                  <th style={{ textAlign: 'right' }}>Mkt Value</th>
                  <th style={{ textAlign: 'right' }}>P&L</th>
                  <th style={{ textAlign: 'right' }}>P&L %</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => {
                  const pnlClass = position.unrealizedPnL >= 0 ? 'text-positive' : 'text-negative';
                  const contractDesc = getContractDescription(position);

                  return (
                    <tr key={position.id}>
                      <td className="table-mono">
                        {position.optionDetails?.underlying || position.symbol}
                      </td>
                      <td className="table-mono">{contractDesc}</td>
                      <td>
                        {position.assetClass === 'option' && position.optionDetails ? (
                          <span
                            className={`badge badge--${position.optionDetails.optionType}`}
                          >
                            {position.optionDetails.optionType}
                          </span>
                        ) : (
                          <span className="text-secondary">Equity</span>
                        )}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {position.quantity}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatCurrency(position.averageCost)}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatCurrency(position.currentPrice)}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatCurrency(position.marketValue)}
                      </td>
                      <td
                        className={`table-mono ${pnlClass}`}
                        style={{ textAlign: 'right' }}
                      >
                        {position.unrealizedPnL >= 0 ? '+' : ''}
                        {formatCurrency(position.unrealizedPnL)}
                      </td>
                      <td
                        className={`table-mono ${pnlClass}`}
                        style={{ textAlign: 'right' }}
                      >
                        {formatPercent(position.unrealizedPnLPercent)}
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
