import React, { useState } from 'react';

// ============================================================================
// Types
// ============================================================================

export type DTEBucket = '0-7' | '7-14' | '14-30' | '30-60' | '60-90' | '90+';
export type HoldDurationBucket = 'intraday' | '1-3_days' | '1_week' | '2_weeks' | '1_month' | '1_month+';
export type CatalystCategory = 'earnings' | 'technical' | 'news' | 'sector_move' | 'volatility_play' | 'none' | 'other';
export type TradeOutcome = 'win' | 'loss' | 'breakeven';
export type StrategyType =
  | 'long_call' | 'long_put' | 'short_call' | 'short_put'
  | 'covered_call' | 'cash_secured_put' | 'vertical_spread'
  | 'calendar_spread' | 'iron_condor' | 'straddle' | 'strangle' | 'custom';

export interface PerformanceMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  totalPnL: number;
  totalNetPnL: number;
  avgPnL: number;
  avgWin: number;
  avgLoss: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number;
  expectancy: number;
  avgHoldDays: number;
  totalCommission: number;
}

export interface PerformanceBreakdown<T extends string = string> {
  dimension: string;
  byValue: Record<T, PerformanceMetrics>;
  bestPerforming: T | null;
  worstPerforming: T | null;
}

export interface PerformancePattern {
  id: string;
  type: 'outperformance' | 'underperformance' | 'correlation' | 'trend';
  description: string;
  metrics: {
    sampleSize: number;
    value: number;
    baseline: number;
    difference: number;
    differencePercent: number;
  };
  significance: 'high' | 'medium' | 'low';
  recommendation?: string;
}

export interface ClosedTrade {
  id: string;
  underlying: string;
  strategyType: StrategyType;
  dteAtEntry: number;
  dteBucket: DTEBucket;
  catalyst: CatalystCategory;
  contracts: number;
  entryDate: Date;
  exitDate: Date;
  realizedPnL: number;
  realizedPnLPercent: number;
  outcome: TradeOutcome;
  holdDays: number;
  holdDurationBucket: HoldDurationBucket;
  netPnL: number;
}

export interface DrawdownInfo {
  currentDrawdown: number;
  currentDrawdownDollars: number;
  maxDrawdown: number;
  maxDrawdownDollars: number;
  peakValue: number;
  peakDate: Date;
  currentValue: number;
  daysSincePeak: number;
}

export interface PerformanceAttribution {
  overall: PerformanceMetrics;
  byStrategy: PerformanceBreakdown<StrategyType>;
  byUnderlying: PerformanceBreakdown<string>;
  byDTEBucket: PerformanceBreakdown<DTEBucket>;
  byCatalyst: PerformanceBreakdown<CatalystCategory>;
  byHoldDuration: PerformanceBreakdown<HoldDurationBucket>;
  topTrades: ClosedTrade[];
  worstTrades: ClosedTrade[];
  patterns: PerformancePattern[];
  generatedAt: Date;
}

// ============================================================================
// Props
// ============================================================================

interface PerformancePanelProps {
  attribution: PerformanceAttribution | null;
  drawdown: DrawdownInfo | null;
  loading?: boolean;
  onRefresh?: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatCurrency(value: number): string {
  const prefix = value >= 0 ? '+$' : '-$';
  return `${prefix}${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

function formatStrategyType(strategy: StrategyType): string {
  const formats: Record<StrategyType, string> = {
    long_call: 'Long Call',
    long_put: 'Long Put',
    short_call: 'Short Call',
    short_put: 'Short Put',
    covered_call: 'Covered Call',
    cash_secured_put: 'Cash-Secured Put',
    vertical_spread: 'Vertical Spread',
    calendar_spread: 'Calendar Spread',
    iron_condor: 'Iron Condor',
    straddle: 'Straddle',
    strangle: 'Strangle',
    custom: 'Custom',
  };
  return formats[strategy] || strategy;
}

function formatDTEBucket(bucket: DTEBucket): string {
  const formats: Record<DTEBucket, string> = {
    '0-7': '0-7 DTE',
    '7-14': '7-14 DTE',
    '14-30': '14-30 DTE',
    '30-60': '30-60 DTE',
    '60-90': '60-90 DTE',
    '90+': '90+ DTE',
  };
  return formats[bucket];
}

function formatHoldDuration(bucket: HoldDurationBucket): string {
  const formats: Record<HoldDurationBucket, string> = {
    'intraday': 'Same Day',
    '1-3_days': '1-3 Days',
    '1_week': '1 Week',
    '2_weeks': '2 Weeks',
    '1_month': '1 Month',
    '1_month+': '> 1 Month',
  };
  return formats[bucket];
}

function formatCatalyst(catalyst: CatalystCategory): string {
  const formats: Record<CatalystCategory, string> = {
    'earnings': 'Earnings',
    'technical': 'Technical',
    'news': 'News',
    'sector_move': 'Sector',
    'volatility_play': 'Volatility',
    'none': 'None',
    'other': 'Other',
  };
  return formats[catalyst];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getOutcomeClass(outcome: TradeOutcome): string {
  switch (outcome) {
    case 'win':
      return 'text-positive';
    case 'loss':
      return 'text-negative';
    default:
      return 'text-secondary';
  }
}

function getPnLClass(value: number): string {
  if (value > 0) return 'text-positive';
  if (value < 0) return 'text-negative';
  return 'text-secondary';
}

function getSignificanceClass(significance: PerformancePattern['significance']): string {
  switch (significance) {
    case 'high':
      return 'badge--high-significance';
    case 'medium':
      return 'badge--medium-significance';
    default:
      return 'badge--low-significance';
  }
}

function getPatternTypeClass(type: PerformancePattern['type']): string {
  switch (type) {
    case 'outperformance':
      return 'badge--outperform';
    case 'underperformance':
      return 'badge--underperform';
    default:
      return 'badge';
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

function MetricsCard({ metrics }: { metrics: PerformanceMetrics }) {
  return (
    <div className="performance-metrics-grid">
      <div className="metric-card">
        <div className="metric-label">Win Rate</div>
        <div className={`metric-value ${metrics.winRate >= 50 ? 'text-positive' : 'text-negative'}`}>
          {metrics.winRate.toFixed(1)}%
        </div>
        <div className="metric-sublabel">
          {metrics.wins}W / {metrics.losses}L / {metrics.breakevens}BE
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Total P&L</div>
        <div className={`metric-value ${getPnLClass(metrics.totalPnL)}`}>
          {formatCurrency(metrics.totalPnL)}
        </div>
        <div className="metric-sublabel">
          {metrics.totalTrades} trades
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Avg P&L</div>
        <div className={`metric-value ${getPnLClass(metrics.avgPnL)}`}>
          {formatCurrency(metrics.avgPnL)}
        </div>
        <div className="metric-sublabel">per trade</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Profit Factor</div>
        <div className={`metric-value ${metrics.profitFactor >= 1 ? 'text-positive' : 'text-negative'}`}>
          {metrics.profitFactor.toFixed(2)}
        </div>
        <div className="metric-sublabel">wins / losses</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Avg Win</div>
        <div className="metric-value text-positive">
          {formatCurrency(metrics.avgWin)}
        </div>
        <div className="metric-sublabel">max: {formatCurrency(metrics.maxWin)}</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Avg Loss</div>
        <div className="metric-value text-negative">
          {formatCurrency(metrics.avgLoss)}
        </div>
        <div className="metric-sublabel">max: {formatCurrency(metrics.maxLoss)}</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Expectancy</div>
        <div className={`metric-value ${getPnLClass(metrics.expectancy)}`}>
          {formatCurrency(metrics.expectancy)}
        </div>
        <div className="metric-sublabel">per trade expected</div>
      </div>

      <div className="metric-card">
        <div className="metric-label">Avg Hold</div>
        <div className="metric-value">
          {metrics.avgHoldDays.toFixed(1)}
        </div>
        <div className="metric-sublabel">days</div>
      </div>
    </div>
  );
}

function DrawdownCard({ drawdown }: { drawdown: DrawdownInfo }) {
  return (
    <div className="drawdown-card">
      <div className="drawdown-header">
        <h4>Drawdown</h4>
      </div>
      <div className="drawdown-metrics">
        <div className="drawdown-metric">
          <span className="drawdown-label">Current</span>
          <span className={`drawdown-value ${drawdown.currentDrawdown < 0 ? 'text-negative' : ''}`}>
            {formatPercent(drawdown.currentDrawdown)}
          </span>
          <span className="drawdown-sublabel">
            ({formatCurrency(drawdown.currentDrawdownDollars)})
          </span>
        </div>
        <div className="drawdown-metric">
          <span className="drawdown-label">Max Drawdown</span>
          <span className="drawdown-value text-negative">
            {formatPercent(drawdown.maxDrawdown)}
          </span>
          <span className="drawdown-sublabel">
            ({formatCurrency(drawdown.maxDrawdownDollars)})
          </span>
        </div>
        <div className="drawdown-metric">
          <span className="drawdown-label">Peak</span>
          <span className="drawdown-value">
            ${drawdown.peakValue.toFixed(0)}
          </span>
          <span className="drawdown-sublabel">
            {formatDate(drawdown.peakDate)}
          </span>
        </div>
        <div className="drawdown-metric">
          <span className="drawdown-label">Current Value</span>
          <span className="drawdown-value">
            ${drawdown.currentValue.toFixed(0)}
          </span>
          <span className="drawdown-sublabel">
            {drawdown.daysSincePeak > 0 ? `${drawdown.daysSincePeak}d from peak` : 'At peak'}
          </span>
        </div>
      </div>
    </div>
  );
}

type BreakdownKey = 'strategy' | 'underlying' | 'dte' | 'catalyst' | 'holdDuration';

function BreakdownTable({
  breakdown,
  formatValue,
}: {
  breakdown: PerformanceBreakdown<string>;
  formatValue: (value: string) => string;
}) {
  const entries = Object.entries(breakdown.byValue)
    .filter(([_, metrics]) => metrics.totalTrades > 0)
    .sort((a, b) => b[1].winRate - a[1].winRate);

  if (entries.length === 0) {
    return (
      <div className="empty-state-small">
        <p>No data</p>
      </div>
    );
  }

  return (
    <table className="breakdown-table">
      <thead>
        <tr>
          <th>{breakdown.dimension}</th>
          <th className="text-right">Trades</th>
          <th className="text-right">Win Rate</th>
          <th className="text-right">Avg P&L</th>
          <th className="text-right">Total P&L</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([value, metrics]) => (
          <tr
            key={value}
            className={
              value === breakdown.bestPerforming
                ? 'row-best'
                : value === breakdown.worstPerforming
                ? 'row-worst'
                : ''
            }
          >
            <td>
              {formatValue(value)}
              {value === breakdown.bestPerforming && (
                <span className="badge badge--best" title="Best performing">TOP</span>
              )}
              {value === breakdown.worstPerforming && (
                <span className="badge badge--worst" title="Worst performing">LOW</span>
              )}
            </td>
            <td className="text-right table-mono">{metrics.totalTrades}</td>
            <td className={`text-right table-mono ${metrics.winRate >= 50 ? 'text-positive' : 'text-negative'}`}>
              {metrics.winRate.toFixed(1)}%
            </td>
            <td className={`text-right table-mono ${getPnLClass(metrics.avgPnL)}`}>
              {formatCurrency(metrics.avgPnL)}
            </td>
            <td className={`text-right table-mono ${getPnLClass(metrics.totalPnL)}`}>
              {formatCurrency(metrics.totalPnL)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TradesTable({ trades, title }: { trades: ClosedTrade[]; title: string }) {
  if (trades.length === 0) {
    return null;
  }

  return (
    <div className="trades-section">
      <h4>{title}</h4>
      <table className="trades-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Strategy</th>
            <th>Entry</th>
            <th>Exit</th>
            <th className="text-right">P&L</th>
            <th className="text-right">P&L %</th>
            <th className="text-center">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td className="table-mono">{trade.underlying}</td>
              <td>{formatStrategyType(trade.strategyType)}</td>
              <td>{formatDate(trade.entryDate)}</td>
              <td>{formatDate(trade.exitDate)}</td>
              <td className={`text-right table-mono ${getPnLClass(trade.realizedPnL)}`}>
                {formatCurrency(trade.realizedPnL)}
              </td>
              <td className={`text-right table-mono ${getPnLClass(trade.realizedPnLPercent)}`}>
                {formatPercent(trade.realizedPnLPercent)}
              </td>
              <td className="text-center">
                <span className={`badge ${getOutcomeClass(trade.outcome)}`}>
                  {trade.outcome.toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PatternsSection({ patterns }: { patterns: PerformancePattern[] }) {
  if (patterns.length === 0) {
    return (
      <div className="patterns-section">
        <h4>Identified Patterns</h4>
        <div className="empty-state-small">
          <p>No significant patterns detected yet. Continue trading to build more data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="patterns-section">
      <h4>Identified Patterns</h4>
      <div className="patterns-list">
        {patterns.map((pattern) => (
          <div key={pattern.id} className="pattern-card">
            <div className="pattern-header">
              <span className={`badge ${getPatternTypeClass(pattern.type)}`}>
                {pattern.type === 'outperformance' ? 'OUTPERFORM' : 'UNDERPERFORM'}
              </span>
              <span className={`badge ${getSignificanceClass(pattern.significance)}`}>
                {pattern.significance.toUpperCase()} CONFIDENCE
              </span>
              <span className="pattern-sample-size">
                ({pattern.metrics.sampleSize} trades)
              </span>
            </div>
            <div className="pattern-description">
              {pattern.description}
            </div>
            {pattern.recommendation && (
              <div className="pattern-recommendation">
                <span className="recommendation-icon">💡</span>
                {pattern.recommendation}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function PerformancePanel({
  attribution,
  drawdown,
  loading = false,
  onRefresh,
}: PerformancePanelProps): React.ReactElement {
  const [selectedBreakdown, setSelectedBreakdown] = useState<BreakdownKey>('strategy');

  if (loading) {
    return (
      <div className="section performance-section">
        <div className="section-header">
          <h2 className="section-title">Performance Attribution</h2>
        </div>
        <div className="loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (!attribution || attribution.overall.totalTrades === 0) {
    return (
      <div className="section performance-section">
        <div className="section-header">
          <h2 className="section-title">Performance Attribution</h2>
          {onRefresh && (
            <button className="btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p className="empty-state-text">No closed trades yet</p>
          <p className="empty-state-subtext">
            Performance metrics will appear here once you close some positions
          </p>
        </div>
      </div>
    );
  }

  const getBreakdownData = (): {
    breakdown: PerformanceBreakdown<string>;
    formatValue: (value: string) => string;
  } => {
    switch (selectedBreakdown) {
      case 'strategy':
        return {
          breakdown: attribution.byStrategy as PerformanceBreakdown<string>,
          formatValue: (v) => formatStrategyType(v as StrategyType),
        };
      case 'underlying':
        return {
          breakdown: attribution.byUnderlying,
          formatValue: (v) => v,
        };
      case 'dte':
        return {
          breakdown: attribution.byDTEBucket as PerformanceBreakdown<string>,
          formatValue: (v) => formatDTEBucket(v as DTEBucket),
        };
      case 'catalyst':
        return {
          breakdown: attribution.byCatalyst as PerformanceBreakdown<string>,
          formatValue: (v) => formatCatalyst(v as CatalystCategory),
        };
      case 'holdDuration':
        return {
          breakdown: attribution.byHoldDuration as PerformanceBreakdown<string>,
          formatValue: (v) => formatHoldDuration(v as HoldDurationBucket),
        };
      default:
        return {
          breakdown: attribution.byStrategy as PerformanceBreakdown<string>,
          formatValue: (v) => formatStrategyType(v as StrategyType),
        };
    }
  };

  const { breakdown, formatValue } = getBreakdownData();

  return (
    <div className="section performance-section">
      <div className="section-header">
        <h2 className="section-title">Performance Attribution</h2>
        <div className="section-header-info">
          <span className="text-secondary">
            {attribution.overall.totalTrades} trades analyzed
          </span>
          {onRefresh && (
            <button className="btn" onClick={onRefresh}>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Overall Metrics */}
      <MetricsCard metrics={attribution.overall} />

      {/* Drawdown Info */}
      {drawdown && <DrawdownCard drawdown={drawdown} />}

      {/* Breakdown Selector */}
      <div className="breakdown-section">
        <div className="breakdown-tabs">
          <button
            className={`breakdown-tab ${selectedBreakdown === 'strategy' ? 'active' : ''}`}
            onClick={() => setSelectedBreakdown('strategy')}
          >
            By Strategy
          </button>
          <button
            className={`breakdown-tab ${selectedBreakdown === 'underlying' ? 'active' : ''}`}
            onClick={() => setSelectedBreakdown('underlying')}
          >
            By Underlying
          </button>
          <button
            className={`breakdown-tab ${selectedBreakdown === 'dte' ? 'active' : ''}`}
            onClick={() => setSelectedBreakdown('dte')}
          >
            By DTE
          </button>
          <button
            className={`breakdown-tab ${selectedBreakdown === 'catalyst' ? 'active' : ''}`}
            onClick={() => setSelectedBreakdown('catalyst')}
          >
            By Catalyst
          </button>
          <button
            className={`breakdown-tab ${selectedBreakdown === 'holdDuration' ? 'active' : ''}`}
            onClick={() => setSelectedBreakdown('holdDuration')}
          >
            By Hold Duration
          </button>
        </div>

        <BreakdownTable breakdown={breakdown} formatValue={formatValue} />
      </div>

      {/* Patterns */}
      <PatternsSection patterns={attribution.patterns} />

      {/* Top and Worst Trades */}
      <div className="trades-sections">
        <TradesTable trades={attribution.topTrades} title="Top Trades" />
        <TradesTable trades={attribution.worstTrades} title="Worst Trades" />
      </div>
    </div>
  );
}
