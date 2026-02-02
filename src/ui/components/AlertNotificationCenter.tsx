/**
 * AlertNotificationCenter Component
 *
 * Displays alert notifications in a notification center panel.
 * Shows alerts triggered by the event-driven alert system with
 * the ability to acknowledge, dismiss, and take action.
 */

import React, { useState, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * Recommended action for an alert
 */
export interface AlertRecommendedActionData {
  action: 'hold' | 'trim' | 'exit' | 'hedge' | 'monitor';
  rationale: string;
  priority: 'high' | 'medium' | 'low';
  symbols: string[];
}

/**
 * Alert context data
 */
export interface AlertContextData {
  currentPrice?: number;
  previousPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
  bid?: number;
  ask?: number;
  spreadPercent?: number;
  position?: {
    symbol: string;
    quantity: number;
    avgCost: number;
    currentValue: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
  };
  portfolio?: {
    totalValue: number;
    dailyPnL: number;
    dailyPnLPercent: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
  };
  daysUntilEarnings?: number;
  earningsDate?: string;
}

/**
 * Alert event data for UI display
 */
export interface AlertEventData {
  id: string;
  triggerId: string;
  triggerName: string;
  triggerType: 'underlying_move' | 'premium_target' | 'earnings_approaching' | 'bid_ask_widening' | 'portfolio_drawdown';
  severity: 'info' | 'warning' | 'critical';
  status: 'active' | 'acknowledged' | 'dismissed' | 'resolved';
  title: string;
  message: string;
  context: AlertContextData;
  recommendedActions: AlertRecommendedActionData[];
  triggeredAt: Date;
  acknowledgedAt?: Date;
  dismissedAt?: Date;
  userNotes?: string;
}

/**
 * Alert preferences for the UI
 */
export interface AlertPreferencesData {
  alertsEnabled: boolean;
  minimumSeverity: 'info' | 'warning' | 'critical';
}

export interface AlertNotificationCenterProps {
  /** Alerts to display */
  alerts: AlertEventData[];
  /** Alert preferences */
  preferences: AlertPreferencesData;
  /** Callback when alert is acknowledged */
  onAcknowledge?: (alertId: string) => void;
  /** Callback when alert is dismissed */
  onDismiss?: (alertId: string) => void;
  /** Callback when all alerts are dismissed */
  onDismissAll?: () => void;
  /** Callback to update preferences */
  onUpdatePreferences?: (updates: Partial<AlertPreferencesData>) => void;
  /** Callback when action button is clicked */
  onActionClick?: (alertId: string, action: AlertRecommendedActionData) => void;
  /** Whether component is in loading state */
  isLoading?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimestamp(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins === 1) return '1 minute ago';
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;

  return date.toLocaleDateString();
}

function formatTriggerType(type: AlertEventData['triggerType']): string {
  switch (type) {
    case 'underlying_move': return 'Price Move';
    case 'premium_target': return 'Premium Target';
    case 'earnings_approaching': return 'Earnings';
    case 'bid_ask_widening': return 'Spread Widening';
    case 'portfolio_drawdown': return 'Drawdown';
    default: return type;
  }
}

function getSeverityIcon(severity: AlertEventData['severity']): string {
  switch (severity) {
    case 'critical': return '!!!';
    case 'warning': return '!!';
    case 'info': return '!';
    default: return '!';
  }
}

function getActionIcon(action: AlertRecommendedActionData['action']): string {
  switch (action) {
    case 'hold': return '-';
    case 'trim': return '/';
    case 'exit': return 'X';
    case 'hedge': return '#';
    case 'monitor': return '*';
    default: return '?';
  }
}

function formatCurrency(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// ============================================================================
// Component
// ============================================================================

export function AlertNotificationCenter({
  alerts,
  preferences,
  onAcknowledge,
  onDismiss,
  onDismissAll,
  onUpdatePreferences,
  onActionClick,
  isLoading = false,
}: AlertNotificationCenterProps): React.ReactElement {
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);

  const toggleExpand = useCallback((alertId: string) => {
    setExpandedAlerts((prev) => {
      const next = new Set(prev);
      if (next.has(alertId)) {
        next.delete(alertId);
      } else {
        next.add(alertId);
      }
      return next;
    });
  }, []);

  // Filter and sort alerts
  const visibleAlerts = alerts
    .filter((a) => showDismissed || a.status !== 'dismissed')
    .sort((a, b) => {
      // Sort by severity first (critical > warning > info)
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      // Then by time (newest first)
      return b.triggeredAt.getTime() - a.triggeredAt.getTime();
    });

  const activeCount = alerts.filter((a) => a.status === 'active').length;
  const acknowledgedCount = alerts.filter((a) => a.status === 'acknowledged').length;

  return (
    <div className="alert-notification-center">
      {/* Header */}
      <div className="alert-center-header">
        <h3 className="alert-center-title">
          Alerts
          {activeCount > 0 && (
            <span className="alert-count-badge alert-count-active">{activeCount}</span>
          )}
        </h3>
        <div className="alert-center-controls">
          <label className="alert-toggle">
            <input
              type="checkbox"
              checked={preferences.alertsEnabled}
              onChange={(e) => onUpdatePreferences?.({ alertsEnabled: e.target.checked })}
            />
            <span>Enabled</span>
          </label>
          <button
            className="btn btn-small btn-secondary"
            onClick={onDismissAll}
            disabled={activeCount === 0 && acknowledgedCount === 0}
          >
            Dismiss All
          </button>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="alert-filters">
        <select
          value={preferences.minimumSeverity}
          onChange={(e) => onUpdatePreferences?.({ minimumSeverity: e.target.value as AlertPreferencesData['minimumSeverity'] })}
          className="alert-severity-filter"
        >
          <option value="info">Show All</option>
          <option value="warning">Warning+</option>
          <option value="critical">Critical Only</option>
        </select>
        <label className="alert-toggle">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          />
          <span>Show Dismissed</span>
        </label>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="alert-loading">Scanning for alerts...</div>
      )}

      {/* Empty State */}
      {!isLoading && visibleAlerts.length === 0 && (
        <div className="alert-empty">
          <div className="alert-empty-icon">*</div>
          <p>No alerts to display</p>
          <p className="alert-empty-hint">
            Alerts will appear here when triggered by your configured rules
          </p>
        </div>
      )}

      {/* Alert List */}
      <div className="alert-list">
        {visibleAlerts.map((alert) => (
          <div
            key={alert.id}
            className={`alert-card alert-severity-${alert.severity} alert-status-${alert.status}`}
          >
            {/* Alert Header */}
            <div className="alert-card-header" onClick={() => toggleExpand(alert.id)}>
              <div className="alert-severity-badge">
                {getSeverityIcon(alert.severity)}
              </div>
              <div className="alert-card-content">
                <div className="alert-card-title">{alert.title}</div>
                <div className="alert-card-meta">
                  <span className="alert-type-badge">{formatTriggerType(alert.triggerType)}</span>
                  <span className="alert-time">{formatTimestamp(alert.triggeredAt)}</span>
                </div>
              </div>
              <div className="alert-expand-icon">
                {expandedAlerts.has(alert.id) ? 'v' : '>'}
              </div>
            </div>

            {/* Alert Details (expanded) */}
            {expandedAlerts.has(alert.id) && (
              <div className="alert-card-details">
                <p className="alert-message">{alert.message}</p>

                {/* Context Data */}
                {alert.context.position && (
                  <div className="alert-context">
                    <div className="alert-context-row">
                      <span>Position:</span>
                      <span>{alert.context.position.symbol} x{alert.context.position.quantity}</span>
                    </div>
                    <div className="alert-context-row">
                      <span>P&L:</span>
                      <span className={alert.context.position.unrealizedPnL >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(alert.context.position.unrealizedPnL)} ({formatPercent(alert.context.position.unrealizedPnLPercent)})
                      </span>
                    </div>
                  </div>
                )}

                {alert.context.portfolio && (
                  <div className="alert-context">
                    <div className="alert-context-row">
                      <span>Portfolio Value:</span>
                      <span>${alert.context.portfolio.totalValue.toFixed(2)}</span>
                    </div>
                    <div className="alert-context-row">
                      <span>Daily P&L:</span>
                      <span className={alert.context.portfolio.dailyPnL >= 0 ? 'positive' : 'negative'}>
                        {formatCurrency(alert.context.portfolio.dailyPnL)} ({formatPercent(alert.context.portfolio.dailyPnLPercent)})
                      </span>
                    </div>
                  </div>
                )}

                {alert.context.priceChangePercent !== undefined && (
                  <div className="alert-context">
                    <div className="alert-context-row">
                      <span>Price Change:</span>
                      <span className={alert.context.priceChangePercent >= 0 ? 'positive' : 'negative'}>
                        {formatPercent(alert.context.priceChangePercent)}
                      </span>
                    </div>
                  </div>
                )}

                {alert.context.spreadPercent !== undefined && (
                  <div className="alert-context">
                    <div className="alert-context-row">
                      <span>Bid-Ask Spread:</span>
                      <span>{alert.context.spreadPercent.toFixed(2)}%</span>
                    </div>
                  </div>
                )}

                {alert.context.daysUntilEarnings !== undefined && (
                  <div className="alert-context">
                    <div className="alert-context-row">
                      <span>Days Until Earnings:</span>
                      <span>{alert.context.daysUntilEarnings}</span>
                    </div>
                  </div>
                )}

                {/* Recommended Actions */}
                {alert.recommendedActions.length > 0 && (
                  <div className="alert-actions">
                    <h4>Recommended Actions:</h4>
                    {alert.recommendedActions.map((action, idx) => (
                      <div key={idx} className={`alert-action alert-action-priority-${action.priority}`}>
                        <div className="alert-action-header">
                          <span className="alert-action-icon">{getActionIcon(action.action)}</span>
                          <span className="alert-action-type">{action.action.toUpperCase()}</span>
                          <span className={`alert-priority-badge priority-${action.priority}`}>
                            {action.priority}
                          </span>
                        </div>
                        <p className="alert-action-rationale">{action.rationale}</p>
                        {action.symbols.length > 0 && (
                          <div className="alert-action-symbols">
                            {action.symbols.map((s) => (
                              <span key={s} className="alert-symbol-badge">{s}</span>
                            ))}
                          </div>
                        )}
                        <button
                          className="btn btn-small btn-action"
                          onClick={() => onActionClick?.(alert.id, action)}
                        >
                          Take Action
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Alert Control Buttons */}
                <div className="alert-card-buttons">
                  {alert.status === 'active' && (
                    <button
                      className="btn btn-small btn-secondary"
                      onClick={() => onAcknowledge?.(alert.id)}
                    >
                      Acknowledge
                    </button>
                  )}
                  {(alert.status === 'active' || alert.status === 'acknowledged') && (
                    <button
                      className="btn btn-small btn-secondary"
                      onClick={() => onDismiss?.(alert.id)}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Summary Footer */}
      <div className="alert-center-footer">
        <span className="alert-summary">
          {activeCount} active, {acknowledgedCount} acknowledged, {alerts.filter((a) => a.status === 'dismissed').length} dismissed
        </span>
      </div>
    </div>
  );
}

export default AlertNotificationCenter;
