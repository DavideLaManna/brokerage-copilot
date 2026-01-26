import React from 'react';

/**
 * Types for exposure data
 */
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
}

interface ExposurePanelProps {
  exposure: PortfolioExposure | null;
  concentrationLimit?: number;
  loading?: boolean;
  onRefresh?: () => void;
}

/**
 * Format currency for display
 */
function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * Format percentage for display
 */
function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * ExposurePanel component displays portfolio exposure by underlying
 */
export default function ExposurePanel({
  exposure,
  concentrationLimit = 10,
  loading = false,
  onRefresh,
}: ExposurePanelProps): React.ReactElement {
  if (loading) {
    return (
      <div className="section section--full-width">
        <div className="section-header">
          <h2 className="section-title">Exposure by Underlying</h2>
        </div>
        <div className="loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (!exposure || exposure.underlyings.length === 0) {
    return (
      <div className="section section--full-width">
        <div className="section-header">
          <h2 className="section-title">Exposure by Underlying</h2>
          {onRefresh && (
            <button className="btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p className="empty-state-text">No positions to analyze</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section section--full-width">
      <div className="section-header">
        <h2 className="section-title">Exposure by Underlying</h2>
        <div className="exposure-summary">
          <span className="text-secondary">
            {exposure.underlyingCount} underlying{exposure.underlyingCount !== 1 ? 's' : ''}
          </span>
          {exposure.exceedingLimitCount > 0 && (
            <span className="badge badge--liquidity-very-low">
              {exposure.exceedingLimitCount} over limit
            </span>
          )}
          {onRefresh && (
            <button className="btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="exposure-stats">
        <div className="stat-card">
          <div className="stat-label">Total Notional</div>
          <div className="stat-value table-mono">
            {formatCurrency(exposure.totalNotionalExposure)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Risk</div>
          <div className="stat-value table-mono">
            {formatCurrency(exposure.totalRisk)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Risk % of Account</div>
          <div className={`stat-value table-mono ${exposure.totalRiskPercent > 50 ? 'stat-value--negative' : ''}`}>
            {formatPercent(exposure.totalRiskPercent)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Concentration Limit</div>
          <div className="stat-value table-mono text-secondary">
            {formatPercent(concentrationLimit)}
          </div>
        </div>
      </div>

      {/* Exposure Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Positions</th>
              <th>Net Qty</th>
              <th>Market Value</th>
              <th>Notional</th>
              <th>Risk</th>
              <th>Risk %</th>
              <th>P&L</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {exposure.underlyings.map((underlying) => (
              <tr
                key={underlying.symbol}
                className={underlying.exceedsLimit ? 'row--warning' : ''}
              >
                <td>
                  <span className="table-mono" style={{ fontWeight: 600 }}>
                    {underlying.symbol}
                  </span>
                </td>
                <td className="text-secondary">{underlying.positionCount}</td>
                <td className="table-mono">
                  <span className={underlying.netQuantity >= 0 ? 'text-positive' : 'text-negative'}>
                    {underlying.netQuantity >= 0 ? '+' : ''}
                    {underlying.netQuantity.toFixed(0)}
                  </span>
                </td>
                <td className="table-mono">{formatCurrency(underlying.marketValue)}</td>
                <td className="table-mono">{formatCurrency(underlying.notionalExposure)}</td>
                <td className="table-mono">{formatCurrency(underlying.risk)}</td>
                <td className="table-mono">
                  <span className={underlying.exceedsLimit ? 'text-negative' : ''}>
                    {formatPercent(underlying.riskPercent)}
                  </span>
                  {underlying.exceedsLimit && <span className="warning-icon">⚠</span>}
                </td>
                <td className="table-mono">
                  <span className={underlying.unrealizedPnL >= 0 ? 'text-positive' : 'text-negative'}>
                    {underlying.unrealizedPnL >= 0 ? '+' : ''}
                    {formatCurrency(underlying.unrealizedPnL)}
                  </span>
                </td>
                <td>
                  {underlying.exceedsLimit ? (
                    <span className="badge badge--liquidity-very-low">OVER LIMIT</span>
                  ) : (
                    <span className="badge badge--liquidity-high">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Warning Messages */}
      {exposure.exceedingLimitCount > 0 && (
        <div className="exposure-warnings">
          {exposure.underlyings
            .filter((u) => u.exceedsLimit && u.warning)
            .map((u) => (
              <div key={u.symbol} className="exposure-warning">
                <span className="warning-icon">⚠</span>
                <span>{u.warning}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
