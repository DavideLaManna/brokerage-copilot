import React from 'react';
import type { AccountSummary as AccountSummaryType } from '../types';

interface Props {
  data: AccountSummaryType | null;
  loading?: boolean;
}

function formatCurrency(value: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPnL(value: number, currency: string = 'USD'): { text: string; className: string } {
  const prefix = value >= 0 ? '+' : '';
  const text = prefix + formatCurrency(value, currency);
  const className = value >= 0 ? 'stat-value--positive' : 'stat-value--negative';
  return { text, className };
}

export default function AccountSummary({ data, loading }: Props): React.ReactElement {
  if (loading) {
    return (
      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Account Summary</h2>
        </header>
        <div className="section-content">
          <div className="loading">
            <div className="loading-spinner" />
          </div>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="section">
        <header className="section-header">
          <h2 className="section-title">Account Summary</h2>
        </header>
        <div className="section-content">
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <p className="empty-state-text">Connect to a broker to view account summary</p>
          </div>
        </div>
      </section>
    );
  }

  const dailyPnL = formatPnL(data.dailyPnL, data.currency);
  const unrealizedPnL = formatPnL(data.unrealizedPnL, data.currency);

  return (
    <section className="section">
      <header className="section-header">
        <h2 className="section-title">Account Summary</h2>
        <span className="text-secondary" style={{ fontSize: 'var(--text-xs)' }}>
          As of {data.asOf.toLocaleTimeString()}
        </span>
      </header>
      <div className="section-content">
        <div className="account-summary-grid">
          <div className="stat-card">
            <div className="stat-label">Net Liquidation</div>
            <div className="stat-value">{formatCurrency(data.netLiquidation, data.currency)}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Buying Power</div>
            <div className="stat-value">{formatCurrency(data.buyingPower, data.currency)}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Cash</div>
            <div className="stat-value">{formatCurrency(data.cash, data.currency)}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Daily P&L</div>
            <div className={`stat-value ${dailyPnL.className}`}>{dailyPnL.text}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Unrealized P&L</div>
            <div className={`stat-value ${unrealizedPnL.className}`}>{unrealizedPnL.text}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
