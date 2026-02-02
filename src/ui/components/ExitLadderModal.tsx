/**
 * ExitLadderModal Component
 *
 * Modal for setting up staged profit-taking orders (exit ladders) on a position.
 * Allows users to select preset targets or customize, preview orders, and approve.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Position } from '../types';

// ============================================================================
// Types
// ============================================================================

export type LadderPreset = 'conservative' | 'standard' | 'aggressive' | 'custom';

export interface ExitLadderRung {
  targetProfitPercent: number;
  closePercent: number;
}

export interface ExitLadderOrder {
  rungIndex: number;
  targetProfitPercent: number;
  exitPrice: number;
  contractsToClose: number;
  estimatedCredit: number;
  estimatedProfit: number;
  currentPrice: number;
  costBasis: number;
  validationPassed?: boolean;
  validationMessage?: string;
}

export interface ExitLadderProposal {
  proposalId: string;
  position: Position;
  orders: ExitLadderOrder[];
  correlationId: string;
  totalContractsToExit: number;
  contractsRemaining: number;
  totalEstimatedCredit: number;
  totalEstimatedProfit: number;
  validationSummary: {
    allPassed: boolean;
    passedCount: number;
    failedCount: number;
    failureReasons: string[];
  };
  warnings: string[];
  config: {
    rungs: ExitLadderRung[];
    orderType: 'limit' | 'market';
    timeInForce: 'day' | 'gtc' | 'ioc' | 'fok';
    validateOrders: boolean;
  };
  createdAt: string;
}

export interface ExitLadderModalProps {
  position: Position;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (proposal: ExitLadderProposal) => void;
  isSubmitting?: boolean;
  demoMode?: boolean;
}

// ============================================================================
// Preset Ladders
// ============================================================================

const PRESET_LADDERS: Record<Exclude<LadderPreset, 'custom'>, ExitLadderRung[]> = {
  conservative: [
    { targetProfitPercent: 15, closePercent: 34 },
    { targetProfitPercent: 30, closePercent: 33 },
    { targetProfitPercent: 50, closePercent: 33 },
  ],
  standard: [
    { targetProfitPercent: 25, closePercent: 34 },
    { targetProfitPercent: 50, closePercent: 33 },
    { targetProfitPercent: 100, closePercent: 33 },
  ],
  aggressive: [
    { targetProfitPercent: 50, closePercent: 25 },
    { targetProfitPercent: 100, closePercent: 25 },
    { targetProfitPercent: 200, closePercent: 50 },
  ],
};

const PRESET_DESCRIPTIONS: Record<Exclude<LadderPreset, 'custom'>, string> = {
  conservative: 'Take profits early at 15%, 30%, 50%',
  standard: 'Balanced exits at 25%, 50%, 100%',
  aggressive: 'Let winners run at 50%, 100%, 200%',
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  return `$${absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

function calculateExitPrice(costBasis: number, targetProfitPercent: number): number {
  const exitPrice = costBasis * (1 + targetProfitPercent / 100);
  return Math.round(exitPrice * 100) / 100;
}

function calculateContractsToClose(
  totalQuantity: number,
  closePercent: number,
  previouslyClosed: number,
  isLastRung: boolean
): number {
  const remainingQuantity = totalQuantity - previouslyClosed;
  if (remainingQuantity <= 0) return 0;
  if (isLastRung) return remainingQuantity;
  const contractsFromPercent = Math.floor((totalQuantity * closePercent) / 100);
  const contracts = Math.max(1, contractsFromPercent);
  return Math.min(contracts, remainingQuantity);
}

function buildMockProposal(
  position: Position,
  rungs: ExitLadderRung[]
): ExitLadderProposal {
  const sortedRungs = [...rungs].sort((a, b) => a.targetProfitPercent - b.targetProfitPercent);
  const totalQuantity = Math.abs(position.quantity);
  const costBasis = position.averageCost;
  const currentPrice = position.currentPrice;
  const multiplier = position.optionDetails?.multiplier || 100;

  let contractsAllocated = 0;
  let totalEstimatedCredit = 0;
  let totalEstimatedProfit = 0;
  const orders: ExitLadderOrder[] = [];

  for (let i = 0; i < sortedRungs.length; i++) {
    const rung = sortedRungs[i]!;
    const isLastRung = i === sortedRungs.length - 1;
    const contractsToClose = calculateContractsToClose(
      totalQuantity,
      rung.closePercent,
      contractsAllocated,
      isLastRung
    );

    if (contractsToClose === 0) continue;

    const exitPrice = calculateExitPrice(costBasis, rung.targetProfitPercent);
    const estimatedCredit = exitPrice * contractsToClose * multiplier;
    const costForContracts = costBasis * contractsToClose * multiplier;
    const estimatedProfit = estimatedCredit - costForContracts;

    orders.push({
      rungIndex: i,
      targetProfitPercent: rung.targetProfitPercent,
      exitPrice,
      contractsToClose,
      currentPrice,
      costBasis,
      estimatedCredit,
      estimatedProfit,
      validationPassed: true,
    });

    contractsAllocated += contractsToClose;
    totalEstimatedCredit += estimatedCredit;
    totalEstimatedProfit += estimatedProfit;
  }

  const contractsRemaining = totalQuantity - contractsAllocated;

  return {
    proposalId: `ladder-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    position,
    orders,
    correlationId: `corr-${Date.now()}`,
    totalContractsToExit: contractsAllocated,
    contractsRemaining,
    totalEstimatedCredit: Math.round(totalEstimatedCredit * 100) / 100,
    totalEstimatedProfit: Math.round(totalEstimatedProfit * 100) / 100,
    validationSummary: {
      allPassed: true,
      passedCount: orders.length,
      failedCount: 0,
      failureReasons: [],
    },
    warnings:
      contractsRemaining > 0
        ? [`${contractsRemaining} contract(s) will remain after ladder completes`]
        : [],
    config: {
      rungs: sortedRungs,
      orderType: 'limit',
      timeInForce: 'gtc',
      validateOrders: true,
    },
    createdAt: new Date().toISOString(),
  };
}

// ============================================================================
// Component
// ============================================================================

export default function ExitLadderModal({
  position,
  isOpen,
  onClose,
  onApprove,
  isSubmitting = false,
  demoMode = false,
}: ExitLadderModalProps): React.ReactElement | null {
  const [selectedPreset, setSelectedPreset] = useState<LadderPreset>('standard');
  const [customRungs, setCustomRungs] = useState<ExitLadderRung[]>([
    { targetProfitPercent: 25, closePercent: 50 },
    { targetProfitPercent: 50, closePercent: 50 },
  ]);
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<ExitLadderProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Get the active rungs based on selected preset
  const activeRungs = useMemo(() => {
    if (selectedPreset === 'custom') {
      return customRungs;
    }
    return PRESET_LADDERS[selectedPreset];
  }, [selectedPreset, customRungs]);

  // Build/fetch proposal when rungs change
  useEffect(() => {
    if (!isOpen || !position) return;

    const buildProposal = async () => {
      setLoading(true);
      setError(null);

      try {
        if (demoMode) {
          // Simulate API delay
          await new Promise((resolve) => setTimeout(resolve, 300));
          const mockProposal = buildMockProposal(position, activeRungs);
          setProposal(mockProposal);
        } else {
          // Real API call
          const response = await fetch('/api/exit-ladder/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              positionId: position.id,
              rungs: activeRungs,
            }),
          });

          const json = await response.json();
          if (!json.success) {
            throw new Error(json.error || 'Failed to build exit ladder');
          }
          setProposal(json.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to build exit ladder');
        setProposal(null);
      } finally {
        setLoading(false);
      }
    };

    buildProposal();
  }, [isOpen, position, activeRungs, demoMode]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPreset('standard');
      setError(null);
    }
  }, [isOpen]);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const handleApprove = useCallback(() => {
    if (proposal) {
      onApprove(proposal);
    }
  }, [proposal, onApprove]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isSubmitting) {
        onClose();
      }
    },
    [isSubmitting, onClose]
  );

  const handleAddCustomRung = useCallback(() => {
    if (customRungs.length >= 5) return;
    const maxTarget = Math.max(...customRungs.map((r) => r.targetProfitPercent), 0);
    setCustomRungs([
      ...customRungs,
      { targetProfitPercent: maxTarget + 25, closePercent: 25 },
    ]);
  }, [customRungs]);

  const handleRemoveCustomRung = useCallback((index: number) => {
    setCustomRungs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpdateCustomRung = useCallback(
    (index: number, field: keyof ExitLadderRung, value: number) => {
      setCustomRungs((prev) =>
        prev.map((rung, i) => (i === index ? { ...rung, [field]: value } : rung))
      );
    },
    []
  );

  if (!isOpen) {
    return null;
  }

  const positionSymbol = position.optionDetails?.optionSymbol || position.symbol;
  const underlying = position.optionDetails?.underlying || position.symbol;
  const isLongPosition = position.quantity > 0;
  const canApprove = proposal && proposal.validationSummary.allPassed && !isSubmitting;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal modal--exit-ladder" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Set Exit Ladder</h2>
          <button
            className="modal-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="modal-content">
          {/* Position Summary */}
          <section className="approval-section">
            <h3 className="approval-section-title">Position</h3>
            <div className="exit-ladder-position">
              <div className="exit-ladder-position-header">
                <span className="exit-ladder-symbol">{underlying}</span>
                <span className="exit-ladder-contract table-mono">{positionSymbol}</span>
                {position.optionDetails && (
                  <span
                    className={`badge badge--${position.optionDetails.optionType}`}
                  >
                    {position.optionDetails.optionType}
                  </span>
                )}
              </div>
              <div className="exit-ladder-position-details">
                <div className="exit-ladder-detail">
                  <span className="detail-label">Quantity:</span>
                  <span className="detail-value table-mono">
                    {Math.abs(position.quantity)} contracts
                  </span>
                </div>
                <div className="exit-ladder-detail">
                  <span className="detail-label">Avg Cost:</span>
                  <span className="detail-value table-mono">
                    {formatCurrency(position.averageCost)}
                  </span>
                </div>
                <div className="exit-ladder-detail">
                  <span className="detail-label">Current:</span>
                  <span className="detail-value table-mono">
                    {formatCurrency(position.currentPrice)}
                  </span>
                </div>
                <div className="exit-ladder-detail">
                  <span className="detail-label">P&L:</span>
                  <span
                    className={`detail-value table-mono ${
                      position.unrealizedPnL >= 0 ? 'text-positive' : 'text-negative'
                    }`}
                  >
                    {position.unrealizedPnL >= 0 ? '+' : ''}
                    {formatCurrency(position.unrealizedPnL)} (
                    {position.unrealizedPnLPercent >= 0 ? '+' : ''}
                    {position.unrealizedPnLPercent.toFixed(1)}%)
                  </span>
                </div>
                {position.optionDetails && (
                  <div className="exit-ladder-detail">
                    <span className="detail-label">Expiration:</span>
                    <span className="detail-value table-mono">
                      {formatDate(new Date(position.optionDetails.expiration))}
                    </span>
                  </div>
                )}
              </div>
            </div>
            {!isLongPosition && (
              <div className="exit-ladder-warning">
                <span className="warning-icon">&#9888;</span>
                Exit ladders are designed for long positions. This position is short.
              </div>
            )}
          </section>

          {/* Ladder Configuration */}
          <section className="approval-section">
            <h3 className="approval-section-title">Profit Targets</h3>
            <div className="exit-ladder-presets">
              {(Object.keys(PRESET_LADDERS) as Exclude<LadderPreset, 'custom'>[]).map(
                (preset) => (
                  <button
                    key={preset}
                    className={`exit-ladder-preset-btn ${
                      selectedPreset === preset ? 'exit-ladder-preset-btn--active' : ''
                    }`}
                    onClick={() => setSelectedPreset(preset)}
                    disabled={isSubmitting}
                  >
                    <span className="preset-name">
                      {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    </span>
                    <span className="preset-description">{PRESET_DESCRIPTIONS[preset]}</span>
                  </button>
                )
              )}
              <button
                className={`exit-ladder-preset-btn ${
                  selectedPreset === 'custom' ? 'exit-ladder-preset-btn--active' : ''
                }`}
                onClick={() => setSelectedPreset('custom')}
                disabled={isSubmitting}
              >
                <span className="preset-name">Custom</span>
                <span className="preset-description">Define your own targets</span>
              </button>
            </div>

            {/* Custom Rungs Editor */}
            {selectedPreset === 'custom' && (
              <div className="exit-ladder-custom-rungs">
                <h4 className="approval-subsection-title">Custom Targets</h4>
                {customRungs.map((rung, index) => (
                  <div key={index} className="exit-ladder-custom-rung">
                    <div className="custom-rung-field">
                      <label>Target Profit</label>
                      <div className="custom-rung-input-group">
                        <input
                          type="number"
                          min="1"
                          max="500"
                          value={rung.targetProfitPercent}
                          onChange={(e) =>
                            handleUpdateCustomRung(
                              index,
                              'targetProfitPercent',
                              parseInt(e.target.value) || 0
                            )
                          }
                          disabled={isSubmitting}
                        />
                        <span className="input-suffix">%</span>
                      </div>
                    </div>
                    <div className="custom-rung-field">
                      <label>Close</label>
                      <div className="custom-rung-input-group">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={rung.closePercent}
                          onChange={(e) =>
                            handleUpdateCustomRung(
                              index,
                              'closePercent',
                              parseInt(e.target.value) || 0
                            )
                          }
                          disabled={isSubmitting}
                        />
                        <span className="input-suffix">%</span>
                      </div>
                    </div>
                    {customRungs.length > 1 && (
                      <button
                        className="btn btn--small btn--danger custom-rung-remove"
                        onClick={() => handleRemoveCustomRung(index)}
                        disabled={isSubmitting}
                        title="Remove target"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                {customRungs.length < 5 && (
                  <button
                    className="btn btn--small exit-ladder-add-rung"
                    onClick={handleAddCustomRung}
                    disabled={isSubmitting}
                  >
                    + Add Target
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Order Preview */}
          <section className="approval-section">
            <h3 className="approval-section-title">
              Order Preview
              {proposal && (
                <span className="approval-checks-status approval-checks-status--pass">
                  {proposal.orders.length} orders
                </span>
              )}
            </h3>

            {loading ? (
              <div className="loading">
                <div className="loading-spinner" />
              </div>
            ) : error ? (
              <div className="exit-ladder-error">
                <span className="error-icon">&#9888;</span>
                {error}
              </div>
            ) : proposal ? (
              <>
                <div className="exit-ladder-orders">
                  {proposal.orders.map((order) => (
                    <div
                      key={order.rungIndex}
                      className={`exit-ladder-order-card ${
                        order.validationPassed === false
                          ? 'exit-ladder-order-card--invalid'
                          : ''
                      }`}
                    >
                      <div className="exit-ladder-order-header">
                        <span className="badge badge--sell">SELL</span>
                        <span className="exit-ladder-order-qty table-mono">
                          {order.contractsToClose}x
                        </span>
                        <span className="exit-ladder-order-target">
                          @ +{order.targetProfitPercent}% profit
                        </span>
                        {order.validationPassed === false && (
                          <span className="badge badge--rejected">FAILED</span>
                        )}
                      </div>
                      <div className="exit-ladder-order-details">
                        <div className="exit-ladder-order-detail">
                          <span className="detail-label">Limit Price:</span>
                          <span className="detail-value table-mono">
                            {formatCurrency(order.exitPrice)}
                          </span>
                        </div>
                        <div className="exit-ladder-order-detail">
                          <span className="detail-label">Est. Credit:</span>
                          <span className="detail-value table-mono text-positive">
                            {formatCurrency(order.estimatedCredit)}
                          </span>
                        </div>
                        <div className="exit-ladder-order-detail">
                          <span className="detail-label">Est. Profit:</span>
                          <span className="detail-value table-mono text-positive">
                            +{formatCurrency(order.estimatedProfit)}
                          </span>
                        </div>
                      </div>
                      {order.validationPassed === false && order.validationMessage && (
                        <div className="exit-ladder-order-validation-error">
                          {order.validationMessage}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Total Summary */}
                <div className="exit-ladder-summary">
                  <div className="exit-ladder-summary-row">
                    <span className="summary-label">Contracts to Exit:</span>
                    <span className="summary-value table-mono">
                      {proposal.totalContractsToExit} of {Math.abs(position.quantity)}
                    </span>
                  </div>
                  {proposal.contractsRemaining > 0 && (
                    <div className="exit-ladder-summary-row">
                      <span className="summary-label">Remaining:</span>
                      <span className="summary-value table-mono">
                        {proposal.contractsRemaining} contracts
                      </span>
                    </div>
                  )}
                  <div className="exit-ladder-summary-row exit-ladder-summary-row--total">
                    <span className="summary-label">Total Est. Credit:</span>
                    <span className="summary-value table-mono text-positive">
                      {formatCurrency(proposal.totalEstimatedCredit)}
                    </span>
                  </div>
                  <div className="exit-ladder-summary-row exit-ladder-summary-row--total">
                    <span className="summary-label">Total Est. Profit:</span>
                    <span className="summary-value table-mono text-positive">
                      +{formatCurrency(proposal.totalEstimatedProfit)}
                    </span>
                  </div>
                </div>

                {/* Validation Summary */}
                {!proposal.validationSummary.allPassed && (
                  <div className="exit-ladder-validation-summary">
                    <h4 className="approval-subsection-title">
                      Validation Failed ({proposal.validationSummary.failedCount} orders)
                    </h4>
                    <ul className="exit-ladder-failure-reasons">
                      {proposal.validationSummary.failureReasons.map((reason, idx) => (
                        <li key={idx}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warnings */}
                {proposal.warnings.length > 0 && (
                  <div className="exit-ladder-warnings">
                    {proposal.warnings.map((warning, idx) => (
                      <div key={idx} className="exit-ladder-warning">
                        <span className="warning-icon">&#9888;</span>
                        {warning}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </section>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="modal-actions">
            <button className="btn btn--secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              className="btn btn--primary"
              onClick={handleApprove}
              disabled={!canApprove}
              title={
                !proposal
                  ? 'Loading...'
                  : !proposal.validationSummary.allPassed
                    ? 'Cannot approve - validation failed'
                    : 'Approve all orders'
              }
            >
              {isSubmitting
                ? 'Submitting...'
                : `Approve ${proposal?.orders.length || 0} Orders`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export types
export type {
  ExitLadderModalProps,
  ExitLadderProposal,
  ExitLadderOrder,
  ExitLadderRung,
  LadderPreset,
};
