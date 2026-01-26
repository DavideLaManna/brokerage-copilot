import React, { useState, useMemo } from 'react';
import type { OptionChain, OptionContract, LiquidityRating } from '../types';

interface Props {
  chain: OptionChain | null;
  loading?: boolean;
  onRefresh?: (symbol: string) => void;
  symbol?: string;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function getLiquidityBadgeClass(rating: LiquidityRating): string {
  switch (rating) {
    case 'high':
      return 'badge--liquidity-high';
    case 'medium':
      return 'badge--liquidity-medium';
    case 'low':
      return 'badge--liquidity-low';
    case 'very_low':
      return 'badge--liquidity-very-low';
  }
}

function getLiquidityLabel(rating: LiquidityRating): string {
  switch (rating) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Med';
    case 'low':
      return 'Low';
    case 'very_low':
      return 'V.Low';
  }
}

function calculateDTE(expiration: Date): number {
  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((expiration.getTime() - now.getTime()) / msPerDay);
}

export default function OptionChainTable({
  chain,
  loading,
  onRefresh,
  symbol = '',
}: Props): React.ReactElement {
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'call' | 'put'>('all');
  const [showWarningsOnly, setShowWarningsOnly] = useState(false);

  // Get available expirations
  const expirations = useMemo(() => {
    if (!chain) return [];
    return Object.keys(chain.contracts).sort();
  }, [chain]);

  // Auto-select first expiration if none selected
  const effectiveExpiration = selectedExpiration || expirations[0] || null;

  // Get contracts for selected expiration
  const contracts = useMemo(() => {
    if (!chain || !effectiveExpiration) return [];
    let filtered = chain.contracts[effectiveExpiration] || [];

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter((c) => c.optionType === filterType);
    }

    // Filter by warnings
    if (showWarningsOnly) {
      filtered = filtered.filter((c) => c.liquidity?.lowLiquidityWarning);
    }

    // Sort by strike
    return [...filtered].sort((a, b) => a.strike - b.strike);
  }, [chain, effectiveExpiration, filterType, showWarningsOnly]);

  // Count warnings
  const warningCount = useMemo(() => {
    if (!chain) return 0;
    let count = 0;
    for (const contractList of Object.values(chain.contracts)) {
      count += contractList.filter((c) => c.liquidity?.lowLiquidityWarning).length;
    }
    return count;
  }, [chain]);

  return (
    <section className="section section--full-width">
      <header className="section-header">
        <h2 className="section-title">
          Option Chain {chain ? `- ${chain.underlying}` : ''}
        </h2>
        {onRefresh && symbol && (
          <button className="btn" onClick={() => onRefresh(symbol)} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        )}
      </header>

      {chain && (
        <div className="option-chain-controls">
          {/* Expiration selector */}
          <div className="option-chain-filter">
            <label htmlFor="expiration-select">Expiration:</label>
            <select
              id="expiration-select"
              value={effectiveExpiration || ''}
              onChange={(e) => setSelectedExpiration(e.target.value)}
              className="select"
            >
              {expirations.map((exp) => {
                const date = new Date(exp);
                const dte = calculateDTE(date);
                return (
                  <option key={exp} value={exp}>
                    {formatDate(date)} ({dte} DTE)
                  </option>
                );
              })}
            </select>
          </div>

          {/* Type filter */}
          <div className="option-chain-filter">
            <label htmlFor="type-filter">Type:</label>
            <select
              id="type-filter"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'call' | 'put')}
              className="select"
            >
              <option value="all">All</option>
              <option value="call">Calls</option>
              <option value="put">Puts</option>
            </select>
          </div>

          {/* Warning filter */}
          <div className="option-chain-filter">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={showWarningsOnly}
                onChange={(e) => setShowWarningsOnly(e.target.checked)}
              />
              Low liquidity only ({warningCount})
            </label>
          </div>

          {/* Underlying price */}
          <div className="option-chain-info">
            <span className="text-secondary">Underlying:</span>
            <span className="table-mono">{formatCurrency(chain.underlyingPrice)}</span>
          </div>
        </div>
      )}

      <div className="section-content">
        {loading ? (
          <div className="loading">
            <div className="loading-spinner" />
          </div>
        ) : !chain ? (
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <p className="empty-state-text">Enter a symbol to view option chain</p>
          </div>
        ) : contracts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <p className="empty-state-text">No contracts match current filters</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Strike</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Bid</th>
                  <th style={{ textAlign: 'right' }}>Ask</th>
                  <th style={{ textAlign: 'right' }}>Mid</th>
                  <th style={{ textAlign: 'right' }}>Spread %</th>
                  <th style={{ textAlign: 'right' }}>Volume</th>
                  <th style={{ textAlign: 'right' }}>OI</th>
                  <th>Liquidity</th>
                  <th style={{ textAlign: 'right' }}>Delta</th>
                  <th style={{ textAlign: 'right' }}>IV</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((contract) => {
                  const liquidity = contract.liquidity;
                  const spreadPercent = liquidity?.spreadPercent ?? 0;
                  const hasWarning = liquidity?.lowLiquidityWarning ?? false;
                  const rating = liquidity?.rating ?? 'very_low';

                  return (
                    <tr
                      key={contract.optionSymbol}
                      className={hasWarning ? 'row--warning' : ''}
                    >
                      <td className="table-mono">{formatCurrency(contract.strike)}</td>
                      <td>
                        <span className={`badge badge--${contract.optionType}`}>
                          {contract.optionType}
                        </span>
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatCurrency(contract.bid)}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatCurrency(contract.ask)}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatCurrency(contract.mid)}
                      </td>
                      <td
                        className={`table-mono ${hasWarning ? 'text-negative' : ''}`}
                        style={{ textAlign: 'right' }}
                        title={liquidity?.description}
                      >
                        {isFinite(spreadPercent) ? `${spreadPercent.toFixed(2)}%` : 'N/A'}
                        {hasWarning && <span className="warning-icon" title="Low liquidity">⚠</span>}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatNumber(contract.volume)}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {formatNumber(contract.openInterest)}
                      </td>
                      <td>
                        <span
                          className={`badge ${getLiquidityBadgeClass(rating)}`}
                          title={liquidity?.description}
                        >
                          {getLiquidityLabel(rating)}
                        </span>
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {contract.greeks?.delta !== undefined
                          ? contract.greeks.delta.toFixed(2)
                          : 'N/A'}
                      </td>
                      <td className="table-mono" style={{ textAlign: 'right' }}>
                        {contract.greeks?.impliedVolatility !== undefined
                          ? `${(contract.greeks.impliedVolatility * 100).toFixed(1)}%`
                          : 'N/A'}
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
