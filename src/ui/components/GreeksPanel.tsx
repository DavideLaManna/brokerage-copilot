import React from 'react';

/**
 * Portfolio Greeks data structure
 */
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

interface GreeksPanelProps {
  greeks: PortfolioGreeks | null;
  loading?: boolean;
  onRefresh?: () => void;
}

/**
 * Format Greek value with sign
 */
function formatGreek(value: number, decimals: number = 2): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(decimals)}`;
}

/**
 * Get CSS class based on Greek value
 */
function getValueClass(value: number, isTheta: boolean = false): string {
  // For theta, positive is good (collecting premium), negative is bad (paying premium)
  // For delta/gamma/vega, it's more contextual but we color based on direction
  if (isTheta) {
    return value >= 0 ? 'text-positive' : 'text-negative';
  }
  // For other Greeks, just show the direction
  return value >= 0 ? 'text-positive' : 'text-negative';
}

/**
 * Get interpretation text for Greeks
 */
function getInterpretations(greeks: PortfolioGreeks): string[] {
  const hints: string[] = [];

  // Delta interpretation
  if (Math.abs(greeks.delta) > 100) {
    if (greeks.delta > 0) {
      hints.push(`Long ${greeks.delta.toFixed(0)} delta-equivalent shares`);
    } else {
      hints.push(`Short ${Math.abs(greeks.delta).toFixed(0)} delta-equivalent shares`);
    }
  } else if (Math.abs(greeks.delta) < 10 && greeks.totalOptionPositions > 0) {
    hints.push('Approximately delta-neutral');
  }

  // Theta interpretation
  if (greeks.theta < -50) {
    hints.push(`Paying $${Math.abs(greeks.theta).toFixed(0)}/day in time decay`);
  } else if (greeks.theta > 50) {
    hints.push(`Collecting $${greeks.theta.toFixed(0)}/day from time decay`);
  }

  // Vega interpretation
  if (Math.abs(greeks.vega) > 100) {
    if (greeks.vega > 0) {
      hints.push(`+$${greeks.vega.toFixed(0)} per 1% IV increase`);
    } else {
      hints.push(`-$${Math.abs(greeks.vega).toFixed(0)} per 1% IV increase`);
    }
  }

  // Missing Greeks warning
  if (greeks.positionsWithoutGreeks > 0 && greeks.totalOptionPositions > 0) {
    const pct = ((greeks.positionsWithoutGreeks / greeks.totalOptionPositions) * 100).toFixed(0);
    hints.push(`${greeks.positionsWithoutGreeks} position${greeks.positionsWithoutGreeks > 1 ? 's' : ''} (${pct}%) missing Greeks`);
  }

  return hints;
}

/**
 * GreeksPanel component displays aggregated portfolio Greeks
 */
export default function GreeksPanel({
  greeks,
  loading = false,
  onRefresh,
}: GreeksPanelProps): React.ReactElement {
  if (loading) {
    return (
      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Portfolio Greeks</h2>
        </div>
        <div className="loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (!greeks || greeks.totalOptionPositions === 0) {
    return (
      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Portfolio Greeks</h2>
          {onRefresh && (
            <button className="btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">Greeks</div>
          <p className="empty-state-text">No option positions</p>
        </div>
      </div>
    );
  }

  const interpretations = getInterpretations(greeks);
  const hasDataWarning = greeks.positionsWithoutGreeks > 0;

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">Portfolio Greeks</h2>
        <div className="greeks-header-info">
          <span className="text-secondary">
            {greeks.totalOptionPositions} option position{greeks.totalOptionPositions !== 1 ? 's' : ''}
          </span>
          {hasDataWarning && (
            <span className="badge badge--liquidity-low" title="Some positions missing Greeks data">
              {greeks.positionsWithoutGreeks} N/A
            </span>
          )}
          {onRefresh && (
            <button className="btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Greeks Grid */}
      <div className="greeks-grid">
        <div className="greek-card">
          <div className="greek-label">
            Delta
            <span className="greek-sublabel">Directional exposure</span>
          </div>
          <div className={`greek-value table-mono ${getValueClass(greeks.delta)}`}>
            {formatGreek(greeks.delta, 0)}
          </div>
          <div className="greek-unit">shares equiv.</div>
        </div>

        <div className="greek-card">
          <div className="greek-label">
            Gamma
            <span className="greek-sublabel">Delta sensitivity</span>
          </div>
          <div className={`greek-value table-mono ${getValueClass(greeks.gamma)}`}>
            {formatGreek(greeks.gamma, 2)}
          </div>
          <div className="greek-unit">per $1 move</div>
        </div>

        <div className="greek-card">
          <div className="greek-label">
            Theta
            <span className="greek-sublabel">Time decay</span>
          </div>
          <div className={`greek-value table-mono ${getValueClass(greeks.theta, true)}`}>
            {formatGreek(greeks.theta, 0)}
          </div>
          <div className="greek-unit">$/day</div>
        </div>

        <div className="greek-card">
          <div className="greek-label">
            Vega
            <span className="greek-sublabel">Volatility sensitivity</span>
          </div>
          <div className={`greek-value table-mono ${getValueClass(greeks.vega)}`}>
            {formatGreek(greeks.vega, 0)}
          </div>
          <div className="greek-unit">per 1% IV</div>
        </div>
      </div>

      {/* Interpretations */}
      {interpretations.length > 0 && (
        <div className="greeks-interpretations">
          {interpretations.map((hint, index) => (
            <div key={index} className="greeks-interpretation">
              <span className="interpretation-icon">
                {hint.includes('missing') || hint.includes('N/A') ? '!' : '\u2192'}
              </span>
              <span>{hint}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
