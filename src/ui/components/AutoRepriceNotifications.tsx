/**
 * AutoRepriceNotifications Component
 *
 * Displays notifications for auto-reprice activity in the UI.
 * Shows success, warning, and error notifications for automatic
 * order repricing events with the ability to dismiss them.
 */

import React, { useState, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * Auto-reprice notification data
 */
export interface AutoRepriceNotificationData {
  /** Unique ID */
  id: string;
  /** Type of notification */
  type: 'success' | 'warning' | 'error' | 'info';
  /** Short title */
  title: string;
  /** Detailed message */
  message: string;
  /** Related order IDs */
  orderIds: string[];
  /** Related symbols */
  symbols: string[];
  /** Timestamp */
  timestamp: Date;
  /** Whether this has been dismissed */
  dismissed: boolean;
  /** Auto-reprice result details */
  result?: {
    ordersScanned: number;
    successCount: number;
    failedCount: number;
    repriced: Array<{
      orderId: string;
      symbol: string;
      previousPrice: number;
      newPrice: number;
      success: boolean;
      errorMessage?: string;
    }>;
  };
}

/**
 * Auto-reprice status data
 */
export interface AutoRepriceStatus {
  /** Whether auto-reprice is enabled */
  enabled: boolean;
  /** Auto-reprice band percentage */
  bandPercent: number;
  /** Whether auto-reprice is available (not disabled due to errors) */
  available: boolean;
  /** Reason if not available */
  disabledReason?: string;
  /** Last scan timestamp */
  lastScanAt?: Date;
}

export interface AutoRepriceNotificationsProps {
  /** Notifications to display */
  notifications: AutoRepriceNotificationData[];
  /** Current auto-reprice status */
  status: AutoRepriceStatus;
  /** Callback when notification is dismissed */
  onDismiss?: (notificationId: string) => void;
  /** Callback when all notifications are dismissed */
  onDismissAll?: () => void;
  /** Callback to enable auto-reprice */
  onEnableAutoReprice?: () => void;
  /** Callback to disable auto-reprice */
  onDisableAutoReprice?: () => void;
  /** Whether component is in loading state */
  loading?: boolean;
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

  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getNotificationIcon(type: AutoRepriceNotificationData['type']): string {
  switch (type) {
    case 'success':
      return '\u2713'; // Checkmark
    case 'warning':
      return '\u26A0'; // Warning triangle
    case 'error':
      return '\u2717'; // X mark
    case 'info':
    default:
      return '\u2139'; // Info
  }
}

// ============================================================================
// Component
// ============================================================================

export default function AutoRepriceNotifications({
  notifications,
  status,
  onDismiss,
  onDismissAll,
  onEnableAutoReprice,
  onDisableAutoReprice,
  loading = false,
}: AutoRepriceNotificationsProps): React.ReactElement {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const activeNotifications = notifications.filter((n) => !n.dismissed);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const handleDismiss = useCallback(
    (id: string, event: React.MouseEvent) => {
      event.stopPropagation();
      onDismiss?.(id);
    },
    [onDismiss]
  );

  return (
    <div className="auto-reprice-notifications">
      {/* Status Header */}
      <div className="auto-reprice-status">
        <div className="auto-reprice-status-header">
          <h3 className="auto-reprice-title">Auto-Reprice</h3>
          <div className="auto-reprice-controls">
            <span
              className={`auto-reprice-indicator ${
                status.enabled && status.available
                  ? 'auto-reprice-indicator--active'
                  : 'auto-reprice-indicator--inactive'
              }`}
            />
            <span className="auto-reprice-status-text">
              {status.enabled && status.available
                ? `Active (${status.bandPercent}% band)`
                : status.enabled && !status.available
                ? 'Disabled (error)'
                : 'Off'}
            </span>
            {status.enabled ? (
              <button
                className="auto-reprice-toggle auto-reprice-toggle--disable"
                onClick={onDisableAutoReprice}
                disabled={loading}
                title="Disable auto-reprice"
              >
                Disable
              </button>
            ) : (
              <button
                className="auto-reprice-toggle auto-reprice-toggle--enable"
                onClick={onEnableAutoReprice}
                disabled={loading}
                title="Enable auto-reprice"
              >
                Enable
              </button>
            )}
          </div>
        </div>

        {status.disabledReason && (
          <div className="auto-reprice-disabled-reason">
            <span className="warning-icon">{getNotificationIcon('warning')}</span>
            {status.disabledReason}
          </div>
        )}

        {status.lastScanAt && (
          <div className="auto-reprice-last-scan">
            Last scan: {formatTimestamp(status.lastScanAt)}
          </div>
        )}
      </div>

      {/* Notifications List */}
      {activeNotifications.length > 0 && (
        <div className="auto-reprice-notifications-list">
          <div className="auto-reprice-notifications-header">
            <span className="notifications-count">
              {activeNotifications.length} notification{activeNotifications.length !== 1 ? 's' : ''}
            </span>
            {activeNotifications.length > 1 && (
              <button
                className="dismiss-all-btn"
                onClick={onDismissAll}
                title="Dismiss all notifications"
              >
                Dismiss All
              </button>
            )}
          </div>

          {activeNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`auto-reprice-notification auto-reprice-notification--${notification.type}`}
              onClick={() => notification.result && toggleExpanded(notification.id)}
              role={notification.result ? 'button' : undefined}
              tabIndex={notification.result ? 0 : undefined}
            >
              <div className="notification-header">
                <span className={`notification-icon notification-icon--${notification.type}`}>
                  {getNotificationIcon(notification.type)}
                </span>
                <div className="notification-content">
                  <div className="notification-title">{notification.title}</div>
                  <div className="notification-message">{notification.message}</div>
                  {notification.symbols.length > 0 && (
                    <div className="notification-symbols">
                      {notification.symbols.map((symbol) => (
                        <span key={symbol} className="symbol-badge">
                          {symbol}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="notification-timestamp">
                    {formatTimestamp(notification.timestamp)}
                  </div>
                </div>
                <button
                  className="notification-dismiss"
                  onClick={(e) => handleDismiss(notification.id, e)}
                  title="Dismiss"
                  aria-label="Dismiss notification"
                >
                  ×
                </button>
              </div>

              {/* Expanded Details */}
              {notification.result && expandedIds.has(notification.id) && (
                <div className="notification-details">
                  <div className="details-summary">
                    <span>Scanned: {notification.result.ordersScanned}</span>
                    <span>Success: {notification.result.successCount}</span>
                    <span>Failed: {notification.result.failedCount}</span>
                  </div>
                  {notification.result.repriced.length > 0 && (
                    <div className="repriced-orders">
                      {notification.result.repriced.map((order, idx) => (
                        <div
                          key={`${order.orderId}-${idx}`}
                          className={`repriced-order ${
                            order.success ? 'repriced-order--success' : 'repriced-order--failed'
                          }`}
                        >
                          <span className="repriced-symbol">{order.symbol}</span>
                          <span className="repriced-price-change">
                            ${order.previousPrice.toFixed(2)} → ${order.newPrice.toFixed(2)}
                          </span>
                          {!order.success && order.errorMessage && (
                            <span className="repriced-error">{order.errorMessage}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Expand indicator */}
              {notification.result && (
                <div className="notification-expand-indicator">
                  {expandedIds.has(notification.id) ? '▲' : '▼'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {activeNotifications.length === 0 && status.enabled && status.available && (
        <div className="auto-reprice-empty">
          No recent auto-reprice activity
        </div>
      )}
    </div>
  );
}
