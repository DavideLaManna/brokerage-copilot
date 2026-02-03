/**
 * KillSwitchButton Component
 *
 * Emergency kill switch for stopping all automation and entering read-only mode.
 * Displays prominently in the UI with clear visual indication of status.
 *
 * Features:
 * - Prominent red button when system is active
 * - Visual indicator when kill switch is engaged
 * - Confirmation dialog for re-enable
 * - Cooldown timer display
 * - Status summary
 */

import React, { useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * Kill switch status from the API
 */
export interface KillSwitchStatusData {
  state: 'active' | 'inactive';
  readOnlyMode: boolean;
  activatedAt?: string;
  activatedBy?: 'user' | 'system' | 'automated';
  reason?: string;
  reasonCategory?: string;
  ordersCancelled?: number;
  cancelledOrderIds?: string[];
  disabledFeatures?: string[];
  canReEnableAt?: string;
  config: {
    cancelOrdersOnActivation: boolean;
    disableAutoRepriceOnActivation: boolean;
    disableAlertsOnActivation: boolean;
    reEnableCooldownSeconds: number;
    requireConfirmationForReEnable: boolean;
  };
}

/**
 * Kill switch activation result
 */
export interface KillSwitchActivationResult {
  success: boolean;
  status: KillSwitchStatusData;
  ordersCancelled: Array<{
    orderId: string;
    symbol: string;
    side: string;
    quantity: number;
    success: boolean;
    error?: string;
  }>;
  featuresDisabled: string[];
  error?: string;
  activatedAt: string;
}

/**
 * Kill switch deactivation result
 */
export interface KillSwitchDeactivationResult {
  success: boolean;
  status: KillSwitchStatusData;
  featuresReEnabled: string[];
  error?: string;
  deactivatedAt: string;
}

export interface KillSwitchButtonProps {
  /** Current kill switch status */
  status: KillSwitchStatusData;
  /** Callback to activate kill switch */
  onActivate: (reason?: string, cancelOrders?: boolean) => Promise<KillSwitchActivationResult>;
  /** Callback to deactivate kill switch */
  onDeactivate: (confirmed: boolean) => Promise<KillSwitchDeactivationResult>;
  /** Whether the button is in loading state */
  loading?: boolean;
  /** Whether to show compact version */
  compact?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const target = new Date(isoString).getTime();
  const diffMs = target - now;

  if (diffMs <= 0) return 'now';

  const diffSeconds = Math.ceil(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s`;

  const diffMinutes = Math.ceil(diffSeconds / 60);
  return `${diffMinutes}m`;
}

function getRemainingCooldownSeconds(canReEnableAt?: string): number {
  if (!canReEnableAt) return 0;
  const remaining = new Date(canReEnableAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
}

// ============================================================================
// Component
// ============================================================================

const KillSwitchButton: React.FC<KillSwitchButtonProps> = ({
  status,
  onActivate,
  onDeactivate,
  loading = false,
  compact = false,
}) => {
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelOrders, setCancelOrders] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const isActive = status.state === 'active';

  // Update cooldown timer
  useEffect(() => {
    if (!isActive || !status.canReEnableAt) {
      setCooldownRemaining(0);
      return;
    }

    const updateCooldown = () => {
      const remaining = getRemainingCooldownSeconds(status.canReEnableAt);
      setCooldownRemaining(remaining);
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);
    return () => clearInterval(interval);
  }, [isActive, status.canReEnableAt]);

  const handleActivateClick = useCallback(() => {
    setShowActivateDialog(true);
    setError(null);
    setReason('');
    setCancelOrders(false);
  }, []);

  const handleDeactivateClick = useCallback(() => {
    if (cooldownRemaining > 0) {
      setError(`Cannot re-enable yet. Cooldown remaining: ${cooldownRemaining}s`);
      return;
    }
    setShowDeactivateDialog(true);
    setError(null);
  }, [cooldownRemaining]);

  const handleConfirmActivate = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await onActivate(reason || undefined, cancelOrders);
      if (!result.success) {
        setError(result.error || 'Failed to activate kill switch');
      } else {
        setShowActivateDialog(false);
        setReason('');
        setCancelOrders(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsProcessing(false);
    }
  }, [onActivate, reason, cancelOrders]);

  const handleConfirmDeactivate = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await onDeactivate(true);
      if (!result.success) {
        setError(result.error || 'Failed to deactivate kill switch');
      } else {
        setShowDeactivateDialog(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsProcessing(false);
    }
  }, [onDeactivate]);

  const handleCancelDialog = useCallback(() => {
    setShowActivateDialog(false);
    setShowDeactivateDialog(false);
    setError(null);
    setReason('');
    setCancelOrders(false);
  }, []);

  // Compact version - just the button
  if (compact) {
    return (
      <div className="kill-switch-compact">
        {isActive ? (
          <button
            className="kill-switch-btn kill-switch-btn-active"
            onClick={handleDeactivateClick}
            disabled={loading || isProcessing || cooldownRemaining > 0}
            title={cooldownRemaining > 0 ? `Cooldown: ${cooldownRemaining}s` : 'Click to re-enable system'}
          >
            {cooldownRemaining > 0 ? `${cooldownRemaining}s` : 'ACTIVE'}
          </button>
        ) : (
          <button
            className="kill-switch-btn kill-switch-btn-ready"
            onClick={handleActivateClick}
            disabled={loading || isProcessing}
            title="Emergency kill switch"
          >
            KILL
          </button>
        )}

        {showActivateDialog && (
          <KillSwitchActivateDialog
            reason={reason}
            setReason={setReason}
            cancelOrders={cancelOrders}
            setCancelOrders={setCancelOrders}
            error={error}
            isProcessing={isProcessing}
            onConfirm={handleConfirmActivate}
            onCancel={handleCancelDialog}
          />
        )}

        {showDeactivateDialog && (
          <KillSwitchDeactivateDialog
            status={status}
            error={error}
            isProcessing={isProcessing}
            onConfirm={handleConfirmDeactivate}
            onCancel={handleCancelDialog}
          />
        )}
      </div>
    );
  }

  // Full version with status display
  return (
    <div className={`kill-switch-panel ${isActive ? 'kill-switch-panel-active' : ''}`}>
      <div className="kill-switch-header">
        <div className="kill-switch-title">
          <span className="kill-switch-icon">{isActive ? '⛔' : '🛡️'}</span>
          <span>Kill Switch</span>
        </div>
        {isActive && (
          <span className="kill-switch-badge kill-switch-badge-active">ACTIVE</span>
        )}
      </div>

      {isActive ? (
        <div className="kill-switch-active-content">
          <div className="kill-switch-status-message">
            <p><strong>System is in read-only mode.</strong></p>
            <p>All order submission and automation is disabled.</p>
          </div>

          {status.reason && (
            <div className="kill-switch-reason">
              <strong>Reason:</strong> {status.reason}
            </div>
          )}

          {status.activatedAt && (
            <div className="kill-switch-timestamp">
              <strong>Activated:</strong> {formatTimestamp(status.activatedAt)}
            </div>
          )}

          {status.ordersCancelled !== undefined && status.ordersCancelled > 0 && (
            <div className="kill-switch-orders-cancelled">
              <strong>Orders cancelled:</strong> {status.ordersCancelled}
            </div>
          )}

          {status.disabledFeatures && status.disabledFeatures.length > 0 && (
            <div className="kill-switch-disabled-features">
              <strong>Disabled:</strong> {status.disabledFeatures.join(', ')}
            </div>
          )}

          {cooldownRemaining > 0 && (
            <div className="kill-switch-cooldown">
              Re-enable available in: <strong>{cooldownRemaining}s</strong>
            </div>
          )}

          <button
            className="kill-switch-btn kill-switch-btn-reenable"
            onClick={handleDeactivateClick}
            disabled={loading || isProcessing || cooldownRemaining > 0}
          >
            {isProcessing ? 'Processing...' :
             cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` :
             'Re-enable System'}
          </button>

          {error && <div className="kill-switch-error">{error}</div>}
        </div>
      ) : (
        <div className="kill-switch-ready-content">
          <p className="kill-switch-description">
            Activate to immediately stop all automation and enter read-only mode.
          </p>

          <button
            className="kill-switch-btn kill-switch-btn-activate"
            onClick={handleActivateClick}
            disabled={loading || isProcessing}
          >
            {isProcessing ? 'Processing...' : 'ACTIVATE KILL SWITCH'}
          </button>

          {error && <div className="kill-switch-error">{error}</div>}
        </div>
      )}

      {showActivateDialog && (
        <KillSwitchActivateDialog
          reason={reason}
          setReason={setReason}
          cancelOrders={cancelOrders}
          setCancelOrders={setCancelOrders}
          error={error}
          isProcessing={isProcessing}
          onConfirm={handleConfirmActivate}
          onCancel={handleCancelDialog}
        />
      )}

      {showDeactivateDialog && (
        <KillSwitchDeactivateDialog
          status={status}
          error={error}
          isProcessing={isProcessing}
          onConfirm={handleConfirmDeactivate}
          onCancel={handleCancelDialog}
        />
      )}
    </div>
  );
};

// ============================================================================
// Sub-components
// ============================================================================

interface ActivateDialogProps {
  reason: string;
  setReason: (reason: string) => void;
  cancelOrders: boolean;
  setCancelOrders: (cancel: boolean) => void;
  error: string | null;
  isProcessing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const KillSwitchActivateDialog: React.FC<ActivateDialogProps> = ({
  reason,
  setReason,
  cancelOrders,
  setCancelOrders,
  error,
  isProcessing,
  onConfirm,
  onCancel,
}) => (
  <div className="kill-switch-dialog-overlay">
    <div className="kill-switch-dialog">
      <div className="kill-switch-dialog-header">
        <span className="kill-switch-dialog-icon">⚠️</span>
        <h3>Activate Kill Switch</h3>
      </div>

      <div className="kill-switch-dialog-content">
        <p className="kill-switch-dialog-warning">
          This will immediately put the system into <strong>read-only mode</strong>:
        </p>
        <ul className="kill-switch-dialog-effects">
          <li>All order submission will be blocked</li>
          <li>Auto-reprice will be disabled</li>
          <li>Alert monitoring will be disabled</li>
        </ul>

        <div className="kill-switch-dialog-form">
          <label htmlFor="kill-switch-reason">Reason (optional):</label>
          <input
            id="kill-switch-reason"
            type="text"
            className="kill-switch-input"
            placeholder="e.g., Market volatility, system error..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <label className="kill-switch-checkbox">
            <input
              type="checkbox"
              checked={cancelOrders}
              onChange={(e) => setCancelOrders(e.target.checked)}
            />
            <span>Also cancel all open orders</span>
          </label>
          {cancelOrders && (
            <p className="kill-switch-cancel-warning">
              Warning: This will attempt to cancel ALL open orders!
            </p>
          )}
        </div>

        {error && <div className="kill-switch-dialog-error">{error}</div>}
      </div>

      <div className="kill-switch-dialog-actions">
        <button
          className="kill-switch-dialog-btn kill-switch-dialog-btn-cancel"
          onClick={onCancel}
          disabled={isProcessing}
        >
          Cancel
        </button>
        <button
          className="kill-switch-dialog-btn kill-switch-dialog-btn-confirm"
          onClick={onConfirm}
          disabled={isProcessing}
        >
          {isProcessing ? 'Activating...' : 'ACTIVATE'}
        </button>
      </div>
    </div>
  </div>
);

interface DeactivateDialogProps {
  status: KillSwitchStatusData;
  error: string | null;
  isProcessing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const KillSwitchDeactivateDialog: React.FC<DeactivateDialogProps> = ({
  status,
  error,
  isProcessing,
  onConfirm,
  onCancel,
}) => (
  <div className="kill-switch-dialog-overlay">
    <div className="kill-switch-dialog">
      <div className="kill-switch-dialog-header">
        <span className="kill-switch-dialog-icon">✅</span>
        <h3>Re-enable System</h3>
      </div>

      <div className="kill-switch-dialog-content">
        <p>
          This will <strong>deactivate the kill switch</strong> and restore normal operation:
        </p>
        <ul className="kill-switch-dialog-effects">
          <li>Order submission will be allowed</li>
          {status.disabledFeatures?.includes('auto_reprice') && (
            <li>Auto-reprice will be re-enabled</li>
          )}
          {status.disabledFeatures?.includes('alert_monitoring') && (
            <li>Alert monitoring will be re-enabled</li>
          )}
        </ul>

        <p className="kill-switch-confirm-prompt">
          Are you sure you want to re-enable the system?
        </p>

        {error && <div className="kill-switch-dialog-error">{error}</div>}
      </div>

      <div className="kill-switch-dialog-actions">
        <button
          className="kill-switch-dialog-btn kill-switch-dialog-btn-cancel"
          onClick={onCancel}
          disabled={isProcessing}
        >
          Cancel
        </button>
        <button
          className="kill-switch-dialog-btn kill-switch-dialog-btn-reenable"
          onClick={onConfirm}
          disabled={isProcessing}
        >
          {isProcessing ? 'Processing...' : 'Re-enable System'}
        </button>
      </div>
    </div>
  </div>
);

export default KillSwitchButton;
