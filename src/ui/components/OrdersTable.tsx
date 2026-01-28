import React, { useState, useCallback } from 'react';
import type { Order } from '../types';

interface Props {
  orders: Order[];
  loading?: boolean;
  onRefresh?: () => void;
  onCancelOrder?: (orderId: string) => Promise<{ success: boolean; message?: string }>;
}

interface CancelConfirmState {
  isOpen: boolean;
  orderId: string | null;
  orderDescription: string;
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

export default function OrdersTable({ orders, loading, onRefresh, onCancelOrder }: Props): React.ReactElement {
  const [cancelConfirm, setCancelConfirm] = useState<CancelConfirmState>({
    isOpen: false,
    orderId: null,
    orderDescription: '',
  });
  const [canceling, setCanceling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState<string | null>(null);

  // Open cancel confirmation dialog
  const handleCancelClick = useCallback((order: Order) => {
    const description = getContractDescription(order);
    setCancelConfirm({
      isOpen: true,
      orderId: order.id,
      orderDescription: `${order.side.toUpperCase()} ${order.quantity}x ${description}`,
    });
    setCancelError(null);
    setCancelSuccess(null);
  }, []);

  // Close cancel confirmation dialog
  const handleCancelDialogClose = useCallback(() => {
    setCancelConfirm({ isOpen: false, orderId: null, orderDescription: '' });
  }, []);

  // Confirm and execute the cancellation
  const handleCancelConfirm = useCallback(async () => {
    if (!cancelConfirm.orderId || !onCancelOrder) return;

    const orderId = cancelConfirm.orderId;
    setCanceling(orderId);
    setCancelError(null);
    handleCancelDialogClose();

    try {
      const result = await onCancelOrder(orderId);
      if (result.success) {
        setCancelSuccess(`Order ${orderId} has been canceled`);
        // Clear success message after 3 seconds
        setTimeout(() => setCancelSuccess(null), 3000);
      } else {
        setCancelError(result.message || 'Failed to cancel order');
        // Clear error message after 5 seconds
        setTimeout(() => setCancelError(null), 5000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel order';
      setCancelError(message);
      setTimeout(() => setCancelError(null), 5000);
    } finally {
      setCanceling(null);
    }
  }, [cancelConfirm.orderId, onCancelOrder, handleCancelDialogClose]);

  // Check if an order can be canceled
  const canCancel = (order: Order): boolean => {
    const cancelableStatuses = ['open', 'pending', 'partially_filled'];
    return cancelableStatuses.includes(order.status);
  };

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

      {/* Success message */}
      {cancelSuccess && (
        <div className="cancel-message cancel-message--success">
          <span className="cancel-message-icon">✓</span>
          <span>{cancelSuccess}</span>
          <button
            className="cancel-message-dismiss"
            onClick={() => setCancelSuccess(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* Error message */}
      {cancelError && (
        <div className="cancel-message cancel-message--error">
          <span className="cancel-message-icon">⚠</span>
          <span>{cancelError}</span>
          <button
            className="cancel-message-dismiss"
            onClick={() => setCancelError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

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
                  {onCancelOrder && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const contractDesc = getContractDescription(order);
                  const isCanceling = canceling === order.id;

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
                      {onCancelOrder && (
                        <td>
                          {canCancel(order) ? (
                            <button
                              className="btn btn--cancel btn--small"
                              onClick={() => handleCancelClick(order)}
                              disabled={isCanceling}
                              title="Cancel this order"
                            >
                              {isCanceling ? 'Canceling...' : 'Cancel'}
                            </button>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel Confirmation Dialog */}
      {cancelConfirm.isOpen && (
        <div className="modal-overlay" onClick={handleCancelDialogClose}>
          <div className="cancel-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="cancel-dialog-header">
              <h3>Cancel Order</h3>
              <button
                className="cancel-dialog-close"
                onClick={handleCancelDialogClose}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="cancel-dialog-content">
              <p>Are you sure you want to cancel this order?</p>
              <div className="cancel-dialog-order">
                <strong>{cancelConfirm.orderDescription}</strong>
              </div>
              <p className="cancel-dialog-warning">
                This action cannot be undone.
              </p>
            </div>
            <div className="cancel-dialog-actions">
              <button
                className="btn btn--secondary"
                onClick={handleCancelDialogClose}
              >
                Keep Order
              </button>
              <button
                className="btn btn--danger"
                onClick={handleCancelConfirm}
              >
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Export helper functions for testing
export { getContractDescription, getOrderTypeLabel, formatCurrency, formatDate, formatTime };
