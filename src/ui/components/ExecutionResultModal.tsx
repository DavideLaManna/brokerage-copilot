/**
 * ExecutionResultModal Component
 *
 * Modal for displaying order execution results (success/error).
 * Shows broker order IDs, execution status, and any errors.
 */

import React, { useEffect, useCallback } from 'react';
import type { OrderExecutionResponse, OrderSubmissionResult } from '../services/api';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionResultModalProps {
  /** Execution result data */
  result: OrderExecutionResponse | null;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback to refresh portfolio data */
  onRefresh?: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get status display text
 */
function getStatusText(status: OrderExecutionResponse['status']): string {
  switch (status) {
    case 'executed':
      return 'Order Executed Successfully';
    case 'partially_executed':
      return 'Partially Executed';
    case 'failed':
      return 'Execution Failed';
    case 'validation_failed':
      return 'Validation Failed';
    default:
      return 'Unknown Status';
  }
}

/**
 * Get status class name
 */
function getStatusClass(status: OrderExecutionResponse['status']): string {
  switch (status) {
    case 'executed':
      return 'execution-status--success';
    case 'partially_executed':
      return 'execution-status--warning';
    case 'failed':
    case 'validation_failed':
      return 'execution-status--error';
    default:
      return '';
  }
}

/**
 * Get status icon
 */
function getStatusIcon(status: OrderExecutionResponse['status']): string {
  switch (status) {
    case 'executed':
      return '✓';
    case 'partially_executed':
      return '!';
    case 'failed':
    case 'validation_failed':
      return '✗';
    default:
      return '?';
  }
}

// ============================================================================
// Component
// ============================================================================

export default function ExecutionResultModal({
  result,
  isOpen,
  onClose,
  onRefresh,
}: ExecutionResultModalProps): React.ReactElement | null {
  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleClose = useCallback(() => {
    onClose();
    if (onRefresh && result?.success) {
      // Refresh portfolio data after successful execution
      onRefresh();
    }
  }, [onClose, onRefresh, result]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose]
  );

  if (!isOpen || !result) {
    return null;
  }

  const isSuccess = result.status === 'executed';
  const isPartial = result.status === 'partially_executed';
  const succeededOrders = result.orderResults.filter((r) => r.success);
  const failedOrders = result.orderResults.filter((r) => !r.success);

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal modal--execution-result" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Execution Result</h2>
          <button
            className="modal-close"
            onClick={handleClose}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="modal-content">
          {/* Status Banner */}
          <div className={`execution-status-banner ${getStatusClass(result.status)}`}>
            <span className="execution-status-icon">{getStatusIcon(result.status)}</span>
            <span className="execution-status-text">{getStatusText(result.status)}</span>
          </div>

          {/* Summary Section */}
          <section className="execution-section">
            <h3 className="execution-section-title">Summary</h3>
            <div className="execution-summary">
              <div className="execution-summary-item">
                <span className="summary-label">Total Orders:</span>
                <span className="summary-value">{result.summary.total}</span>
              </div>
              <div className="execution-summary-item">
                <span className="summary-label">Succeeded:</span>
                <span className="summary-value text-positive">{result.summary.succeeded}</span>
              </div>
              {result.summary.failed > 0 && (
                <div className="execution-summary-item">
                  <span className="summary-label">Failed:</span>
                  <span className="summary-value text-negative">{result.summary.failed}</span>
                </div>
              )}
            </div>
          </section>

          {/* Broker Order IDs (if successful) */}
          {result.brokerOrderIds.length > 0 && (
            <section className="execution-section">
              <h3 className="execution-section-title">Broker Order IDs</h3>
              <ul className="execution-order-ids">
                {result.brokerOrderIds.map((id, idx) => (
                  <li key={idx} className="execution-order-id">
                    <code>{id}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Successful Orders Detail */}
          {succeededOrders.length > 0 && (
            <section className="execution-section">
              <h3 className="execution-section-title">
                Successful Orders ({succeededOrders.length})
              </h3>
              <div className="execution-orders">
                {succeededOrders.map((order, idx) => (
                  <div key={order.idempotencyKey || idx} className="execution-order execution-order--success">
                    <span className="order-icon">✓</span>
                    <div className="order-details">
                      {order.orderId && (
                        <span className="order-id">
                          Order ID: <code>{order.orderId}</code>
                        </span>
                      )}
                      {order.isDuplicate && (
                        <span className="order-note">(Duplicate - already submitted)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Failed Orders Detail */}
          {failedOrders.length > 0 && (
            <section className="execution-section">
              <h3 className="execution-section-title">
                Failed Orders ({failedOrders.length})
              </h3>
              <div className="execution-orders">
                {failedOrders.map((order, idx) => (
                  <div key={order.idempotencyKey || idx} className="execution-order execution-order--failed">
                    <span className="order-icon">✗</span>
                    <div className="order-details">
                      <span className="order-error">{order.errorMessage || 'Unknown error'}</span>
                      {order.errorCode && (
                        <span className="order-error-code">({order.errorCode})</span>
                      )}
                      {order.retryCount > 0 && (
                        <span className="order-retries">Retried {order.retryCount} times</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Error Message */}
          {result.errorMessage && (
            <section className="execution-section execution-section--error">
              <h3 className="execution-section-title">Error Details</h3>
              <p className="execution-error-message">{result.errorMessage}</p>
            </section>
          )}

          {/* Correlation ID */}
          <section className="execution-section">
            <div className="execution-meta">
              <span className="meta-label">Correlation ID:</span>
              <code className="meta-value">{result.correlationId}</code>
            </div>
            <div className="execution-meta">
              <span className="meta-label">Executed At:</span>
              <span className="meta-value">{new Date(result.executedAt).toLocaleString()}</span>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="modal-actions">
            <button
              className={`btn ${isSuccess ? 'btn--primary' : 'btn--secondary'}`}
              onClick={handleClose}
            >
              {isSuccess ? 'Done' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export for testing
export { getStatusText, getStatusClass, getStatusIcon };
