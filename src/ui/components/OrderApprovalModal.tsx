/**
 * OrderApprovalModal Component
 *
 * Modal for reviewing and approving/rejecting orders before execution.
 * Displays contract details, estimated costs, risk check results,
 * and proposal thesis/rationale.
 */

import React, { useState, useEffect, useCallback } from 'react';

// ============================================================================
// Types
// ============================================================================

export type StrategyType =
  | 'long_call'
  | 'long_put'
  | 'short_call'
  | 'short_put'
  | 'covered_call'
  | 'cash_secured_put'
  | 'vertical_spread'
  | 'calendar_spread'
  | 'iron_condor'
  | 'straddle'
  | 'strangle'
  | 'custom';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export type RiskCheckType =
  | 'risk_per_trade'
  | 'concentration'
  | 'buying_power'
  | 'dte_range'
  | 'liquidity'
  | 'max_positions'
  | 'max_contracts';

export interface RiskCheckResult {
  checkType: RiskCheckType;
  passed: boolean;
  message: string;
  details?: {
    actual?: number;
    limit?: number;
    unit?: string;
  };
}

export interface OrderValidationResult {
  valid: boolean;
  checks: RiskCheckResult[];
  rejectionReasons: string[];
  validatedAt: string;
}

export interface DraftOrderInfo {
  /** Display-friendly order description */
  description: string;
  /** Order side (buy/sell) */
  side: 'buy' | 'sell';
  /** Number of contracts */
  quantity: number;
  /** Underlying symbol */
  underlying: string;
  /** Strike price */
  strike: number;
  /** Expiration date */
  expiration: string;
  /** Option type (call/put) */
  optionType: 'call' | 'put';
  /** Limit price (if any) */
  limitPrice?: number;
  /** Estimated cost (positive = debit, negative = credit) */
  estimatedCost: number;
  /** Idempotency key */
  idempotencyKey: string;
}

export interface TradeProposalInfo {
  /** Strategy type */
  strategyType: StrategyType;
  /** Primary underlying symbol */
  underlying: string;
  /** Thesis explaining the trade rationale (bullet points) */
  thesis: string[];
  /** Catalysts that could move the trade */
  catalysts: string[];
  /** Confidence level in the recommendation */
  confidence: ConfidenceLevel;
  /** Risk assessment */
  risk: {
    maxLoss: number;
    maxLossPercent?: number;
    riskRewardRatio?: number;
    probabilityOfProfit?: number;
  };
  /** Exit plan */
  exitPlan?: {
    profitTargets: Array<{ percentGain: number; closePercent: number }>;
    stopLoss?: { type: 'percent' | 'price'; value: number; trailing?: boolean };
    maxHoldDays?: number;
  };
}

export interface OrderApprovalData {
  /** Proposal ID */
  proposalId?: string;
  /** Draft orders to approve */
  orders: DraftOrderInfo[];
  /** Total estimated cost across all orders */
  totalEstimatedCost: number;
  /** Risk validation result */
  validation: OrderValidationResult;
  /** Trade proposal information */
  proposal: TradeProposalInfo;
  /** Any warnings from draft order building */
  warnings: string[];
}

export interface OrderApprovalModalProps {
  /** Approval data to display */
  data: OrderApprovalData;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Callback when order is approved */
  onApprove: (proposalId?: string) => void;
  /** Callback when order is rejected */
  onReject: (proposalId?: string, reason?: string) => void;
  /** Whether approval is in progress */
  isApproving?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format strategy type for display
 */
function formatStrategyType(strategyType: StrategyType): string {
  const names: Record<StrategyType, string> = {
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
    custom: 'Custom Strategy',
  };
  return names[strategyType] || strategyType;
}

/**
 * Format confidence level for display
 */
function formatConfidence(confidence: ConfidenceLevel): string {
  const names: Record<ConfidenceLevel, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  };
  return names[confidence] || confidence;
}

/**
 * Format risk check type for display
 */
function formatRiskCheckType(checkType: RiskCheckType): string {
  const names: Record<RiskCheckType, string> = {
    risk_per_trade: 'Risk per Trade',
    concentration: 'Concentration',
    buying_power: 'Buying Power',
    dte_range: 'DTE Range',
    liquidity: 'Liquidity',
    max_positions: 'Max Positions',
    max_contracts: 'Max Contracts',
  };
  return names[checkType] || checkType;
}

/**
 * Format currency value
 */
function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  return `$${absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

/**
 * Get confidence badge class
 */
function getConfidenceBadgeClass(confidence: ConfidenceLevel): string {
  switch (confidence) {
    case 'high':
      return 'badge--confidence-high';
    case 'medium':
      return 'badge--confidence-medium';
    case 'low':
      return 'badge--confidence-low';
    default:
      return '';
  }
}

// ============================================================================
// Component
// ============================================================================

export default function OrderApprovalModal({
  data,
  isOpen,
  onClose,
  onApprove,
  onReject,
  isApproving = false,
}: OrderApprovalModalProps): React.ReactElement | null {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setRejectReason('');
      setShowRejectInput(false);
    }
  }, [isOpen]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isApproving) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isApproving, onClose]);

  const handleApprove = useCallback(() => {
    onApprove(data.proposalId);
  }, [data.proposalId, onApprove]);

  const handleReject = useCallback(() => {
    if (showRejectInput) {
      onReject(data.proposalId, rejectReason || undefined);
      setShowRejectInput(false);
      setRejectReason('');
    } else {
      setShowRejectInput(true);
    }
  }, [data.proposalId, onReject, rejectReason, showRejectInput]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isApproving) {
        onClose();
      }
    },
    [isApproving, onClose]
  );

  if (!isOpen) {
    return null;
  }

  const { orders, totalEstimatedCost, validation, proposal, warnings } = data;
  const allChecksPassed = validation.valid;
  const passedChecks = validation.checks.filter((c) => c.passed);
  const failedChecks = validation.checks.filter((c) => !c.passed);

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal modal--order-approval" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Order Approval</h2>
          <button
            className="modal-close"
            onClick={onClose}
            disabled={isApproving}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="modal-content">
          {/* Strategy Overview */}
          <section className="approval-section">
            <h3 className="approval-section-title">Strategy Overview</h3>
            <div className="approval-strategy-header">
              <span className="approval-strategy-name">
                {formatStrategyType(proposal.strategyType)}
              </span>
              <span className="approval-strategy-underlying">{proposal.underlying}</span>
              <span className={`badge ${getConfidenceBadgeClass(proposal.confidence)}`}>
                {formatConfidence(proposal.confidence)} Confidence
              </span>
            </div>
          </section>

          {/* Thesis & Rationale */}
          <section className="approval-section">
            <h3 className="approval-section-title">Thesis & Rationale</h3>
            <ul className="approval-thesis-list">
              {proposal.thesis.map((point, idx) => (
                <li key={idx} className="approval-thesis-item">
                  {point}
                </li>
              ))}
            </ul>

            {proposal.catalysts.length > 0 && (
              <>
                <h4 className="approval-subsection-title">Catalysts</h4>
                <ul className="approval-catalyst-list">
                  {proposal.catalysts.map((catalyst, idx) => (
                    <li key={idx} className="approval-catalyst-item">
                      {catalyst}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Order Details */}
          <section className="approval-section">
            <h3 className="approval-section-title">
              Order Details ({orders.length} {orders.length === 1 ? 'leg' : 'legs'})
            </h3>
            <div className="approval-orders">
              {orders.map((order, idx) => (
                <div key={order.idempotencyKey || idx} className="approval-order-card">
                  <div className="approval-order-header">
                    <span className={`badge badge--${order.side}`}>{order.side.toUpperCase()}</span>
                    <span className="approval-order-qty">{order.quantity}x</span>
                    <span className="approval-order-contract">
                      {order.underlying} {formatDate(order.expiration)} ${order.strike}{' '}
                      <span className={`badge badge--${order.optionType}`}>
                        {order.optionType.toUpperCase()}
                      </span>
                    </span>
                  </div>
                  <div className="approval-order-details">
                    {order.limitPrice !== undefined && (
                      <div className="approval-order-detail">
                        <span className="detail-label">Limit Price:</span>
                        <span className="detail-value table-mono">
                          {formatCurrency(order.limitPrice)}
                        </span>
                      </div>
                    )}
                    <div className="approval-order-detail">
                      <span className="detail-label">Estimated Cost:</span>
                      <span
                        className={`detail-value table-mono ${
                          order.estimatedCost >= 0 ? 'text-negative' : 'text-positive'
                        }`}
                      >
                        {order.estimatedCost >= 0
                          ? `${formatCurrency(order.estimatedCost)} debit`
                          : `${formatCurrency(order.estimatedCost)} credit`}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Total Cost */}
            <div className="approval-total">
              <span className="approval-total-label">Total:</span>
              <span
                className={`approval-total-value table-mono ${
                  totalEstimatedCost >= 0 ? 'text-negative' : 'text-positive'
                }`}
              >
                {totalEstimatedCost >= 0
                  ? `${formatCurrency(totalEstimatedCost)} debit`
                  : `${formatCurrency(totalEstimatedCost)} credit`}
              </span>
            </div>
          </section>

          {/* Risk Assessment */}
          <section className="approval-section">
            <h3 className="approval-section-title">Risk Assessment</h3>
            <div className="approval-risk-stats">
              <div className="approval-risk-stat">
                <span className="risk-stat-label">Max Loss</span>
                <span className="risk-stat-value table-mono text-negative">
                  {formatCurrency(proposal.risk.maxLoss)}
                  {proposal.risk.maxLossPercent !== undefined && (
                    <span className="risk-stat-percent">
                      {' '}
                      ({proposal.risk.maxLossPercent.toFixed(1)}%)
                    </span>
                  )}
                </span>
              </div>
              {proposal.risk.riskRewardRatio !== undefined && (
                <div className="approval-risk-stat">
                  <span className="risk-stat-label">Risk/Reward</span>
                  <span className="risk-stat-value table-mono">
                    1:{proposal.risk.riskRewardRatio.toFixed(1)}
                  </span>
                </div>
              )}
              {proposal.risk.probabilityOfProfit !== undefined && (
                <div className="approval-risk-stat">
                  <span className="risk-stat-label">Prob. of Profit</span>
                  <span className="risk-stat-value table-mono">
                    {proposal.risk.probabilityOfProfit.toFixed(0)}%
                  </span>
                </div>
              )}
            </div>

            {/* Exit Plan */}
            {proposal.exitPlan && (
              <div className="approval-exit-plan">
                <h4 className="approval-subsection-title">Exit Plan</h4>
                <div className="approval-exit-details">
                  {proposal.exitPlan.profitTargets.length > 0 && (
                    <div className="approval-exit-item">
                      <span className="exit-label">Profit Targets:</span>
                      <span className="exit-value">
                        {proposal.exitPlan.profitTargets
                          .map((t) => `+${t.percentGain}% (close ${t.closePercent}%)`)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                  {proposal.exitPlan.stopLoss && (
                    <div className="approval-exit-item">
                      <span className="exit-label">Stop Loss:</span>
                      <span className="exit-value">
                        {proposal.exitPlan.stopLoss.type === 'percent'
                          ? `-${proposal.exitPlan.stopLoss.value}%`
                          : `$${proposal.exitPlan.stopLoss.value}`}
                        {proposal.exitPlan.stopLoss.trailing && ' (trailing)'}
                      </span>
                    </div>
                  )}
                  {proposal.exitPlan.maxHoldDays && (
                    <div className="approval-exit-item">
                      <span className="exit-label">Max Hold:</span>
                      <span className="exit-value">{proposal.exitPlan.maxHoldDays} days</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Risk Checks */}
          <section className="approval-section">
            <h3 className="approval-section-title">
              Risk Checks
              <span
                className={`approval-checks-status ${
                  allChecksPassed ? 'approval-checks-status--pass' : 'approval-checks-status--fail'
                }`}
              >
                {allChecksPassed
                  ? `All ${validation.checks.length} checks passed`
                  : `${failedChecks.length} of ${validation.checks.length} checks failed`}
              </span>
            </h3>

            {/* Failed Checks (show first) */}
            {failedChecks.length > 0 && (
              <div className="approval-checks approval-checks--failed">
                {failedChecks.map((check, idx) => (
                  <div key={idx} className="approval-check approval-check--fail">
                    <span className="check-icon">&#10007;</span>
                    <div className="check-content">
                      <span className="check-type">{formatRiskCheckType(check.checkType)}</span>
                      <span className="check-message">{check.message}</span>
                      {check.details && (
                        <span className="check-details">
                          Actual: {check.details.actual?.toFixed(2)}
                          {check.details.unit} / Limit: {check.details.limit?.toFixed(2)}
                          {check.details.unit}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Passed Checks */}
            {passedChecks.length > 0 && (
              <div className="approval-checks approval-checks--passed">
                {passedChecks.map((check, idx) => (
                  <div key={idx} className="approval-check approval-check--pass">
                    <span className="check-icon">&#10003;</span>
                    <div className="check-content">
                      <span className="check-type">{formatRiskCheckType(check.checkType)}</span>
                      <span className="check-message">{check.message}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Warnings */}
          {warnings.length > 0 && (
            <section className="approval-section approval-section--warnings">
              <h3 className="approval-section-title">Warnings</h3>
              <ul className="approval-warnings">
                {warnings.map((warning, idx) => (
                  <li key={idx} className="approval-warning">
                    <span className="warning-icon">&#9888;</span>
                    {warning}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Rejection Reasons (from validation) */}
          {!allChecksPassed && validation.rejectionReasons.length > 0 && (
            <div className="approval-rejection-summary">
              <h4 className="rejection-summary-title">Cannot Approve - Risk Limits Exceeded</h4>
              <ul className="rejection-reasons">
                {validation.rejectionReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer with actions */}
        <div className="modal-footer">
          {/* Reject input */}
          {showRejectInput && (
            <div className="reject-input-container">
              <input
                type="text"
                className="reject-input"
                placeholder="Reason for rejection (optional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="modal-actions">
            <button
              className="btn btn--secondary"
              onClick={onClose}
              disabled={isApproving}
            >
              Cancel
            </button>

            <button
              className="btn btn--danger"
              onClick={handleReject}
              disabled={isApproving}
            >
              {showRejectInput ? 'Confirm Reject' : 'Reject'}
            </button>

            <button
              className="btn btn--primary"
              onClick={handleApprove}
              disabled={!allChecksPassed || isApproving}
              title={!allChecksPassed ? 'Cannot approve - risk checks failed' : 'Approve order'}
            >
              {isApproving ? 'Approving...' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export helper functions for use in tests and other components
export {
  formatStrategyType,
  formatConfidence,
  formatRiskCheckType,
  formatCurrency,
  formatDate,
  getConfidenceBadgeClass,
};
