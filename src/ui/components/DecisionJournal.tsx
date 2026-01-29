/**
 * DecisionJournal Component
 *
 * Displays audit log entries grouped by day for reviewing past decisions and outcomes.
 * Supports filtering by date range and event type, and allows users to add manual notes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  DecisionJournalProps,
  StoredAuditLogEntry,
  DayGroup,
  JournalStatistics,
  JournalQueryOptions,
  AuditEventType,
  AuditEntryNote,
  RecommendationDetails,
  ApprovalDetails,
  RejectionDetails,
  ExecutionDetails,
  CancellationDetails,
  FillDetails,
  RiskCheckDetails,
} from './DecisionJournal.types';
import {
  formatEventType,
  formatActor,
  getEventTypeColor,
  formatDate,
  formatTime,
  formatCurrency,
} from './DecisionJournal.types';

// ===========================================================================
// Mock Data for Demo Mode
// ===========================================================================

const mockDayGroups: DayGroup[] = [
  {
    date: new Date().toISOString().split('T')[0]!,
    entries: [
      {
        id: 'entry-1',
        timestamp: new Date().toISOString(),
        eventType: 'recommendation',
        actor: 'agent',
        accountId: 'tradier',
        proposalId: 'proposal-1',
        initiatorTag: 'agent_initiated',
        details: {
          type: 'recommendation',
          strategyType: 'long_call',
          underlying: 'NVDA',
          confidence: 'high',
          thesis: ['Strong AI demand', 'Upcoming earnings catalyst', 'Technical breakout above $500'],
          catalysts: ['Earnings report Feb 21', 'Data center growth'],
          contractCount: 5,
          estimatedMaxLoss: 2500,
          estimatedMaxLossPercent: 2.0,
        },
        summary: 'AI Agent recommended long_call on NVDA (high confidence)',
        createdAt: new Date().toISOString(),
        version: 1,
        notes: [
          {
            id: 'note-1',
            text: 'Good setup, watching for entry on pullback',
            addedAt: new Date(Date.now() - 3600000).toISOString(),
          },
        ],
      },
      {
        id: 'entry-2',
        timestamp: new Date(Date.now() - 1800000).toISOString(),
        eventType: 'approval',
        actor: 'user',
        accountId: 'tradier',
        proposalId: 'proposal-1',
        initiatorTag: 'human_initiated',
        details: {
          type: 'approval',
          strategyType: 'long_call',
          underlying: 'NVDA',
          orderCount: 1,
          estimatedCost: 2500,
          riskChecksPassed: true,
        },
        summary: 'User approved long_call on NVDA (1 orders)',
        createdAt: new Date(Date.now() - 1800000).toISOString(),
        version: 1,
      },
      {
        id: 'entry-3',
        timestamp: new Date(Date.now() - 1700000).toISOString(),
        eventType: 'execution',
        actor: 'system',
        accountId: 'tradier',
        proposalId: 'proposal-1',
        orderId: 'ORD-12345',
        initiatorTag: 'system_initiated',
        details: {
          type: 'execution',
          symbol: 'NVDA240315C00550000',
          underlying: 'NVDA',
          side: 'buy',
          quantity: 5,
          orderType: 'limit',
          limitPrice: 5.00,
          idempotencyKey: 'idem-123',
          brokerOrderId: 'ORD-12345',
          success: true,
        },
        summary: 'System submitted BUY 5x NVDA240315C00550000 (Order #ORD-12345)',
        createdAt: new Date(Date.now() - 1700000).toISOString(),
        version: 1,
      },
    ],
  },
  {
    date: new Date(Date.now() - 86400000).toISOString().split('T')[0]!,
    entries: [
      {
        id: 'entry-4',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        eventType: 'fill',
        actor: 'broker',
        accountId: 'tradier',
        orderId: 'ORD-12344',
        initiatorTag: 'system_initiated',
        details: {
          type: 'fill',
          symbol: 'AAPL240216C00185000',
          brokerOrderId: 'ORD-12344',
          filledQuantity: 3,
          totalQuantity: 3,
          fillPrice: 5.85,
          isComplete: true,
          commission: 0.65,
        },
        summary: 'Order #ORD-12344 filled: 3/3 @ $5.85',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        version: 1,
      },
      {
        id: 'entry-5',
        timestamp: new Date(Date.now() - 90000000).toISOString(),
        eventType: 'risk_check',
        actor: 'system',
        accountId: 'tradier',
        initiatorTag: 'system_initiated',
        details: {
          type: 'risk_check',
          trigger: 'pre_trade',
          symbol: 'SPY240315P00475000',
          passed: false,
          checks: [
            { checkType: 'concentration', passed: false, actualValue: 15.5, limit: 10, message: 'Position concentration 15.5% exceeds 10% limit' },
            { checkType: 'buying_power', passed: true, actualValue: 50000, limit: 25000, message: 'Sufficient buying power' },
          ],
          totalChecks: 2,
          passedChecks: 1,
        },
        summary: 'System risk check failed (1/2 checks) for SPY240315P00475000',
        createdAt: new Date(Date.now() - 90000000).toISOString(),
        version: 1,
        notes: [
          {
            id: 'note-2',
            text: 'Reduced position size to comply with concentration limits',
            addedAt: new Date(Date.now() - 85000000).toISOString(),
          },
        ],
      },
    ],
  },
];

const mockStatistics: JournalStatistics = {
  total: 5,
  byEventType: {
    recommendation: 1,
    approval: 1,
    execution: 1,
    fill: 1,
    risk_check: 1,
  },
  byActor: {
    user: 1,
    agent: 1,
    system: 2,
    broker: 1,
  },
  byInitiatorTag: {
    human_initiated: 1,
    agent_initiated: 1,
    system_initiated: 3,
  },
};

// ===========================================================================
// Event Type Filter Options
// ===========================================================================

const EVENT_TYPE_OPTIONS: Array<{ value: AuditEventType; label: string }> = [
  { value: 'recommendation', label: 'Recommendations' },
  { value: 'approval', label: 'Approvals' },
  { value: 'rejection', label: 'Rejections' },
  { value: 'execution', label: 'Executions' },
  { value: 'fill', label: 'Fills' },
  { value: 'cancellation', label: 'Cancellations' },
  { value: 'risk_check', label: 'Risk Checks' },
  { value: 'config_change', label: 'Config Changes' },
  { value: 'connection', label: 'Connections' },
  { value: 'error', label: 'Errors' },
];

// ===========================================================================
// Entry Detail Renderer
// ===========================================================================

function renderEntryDetails(entry: StoredAuditLogEntry): React.ReactNode {
  const { details } = entry;

  switch (details.type) {
    case 'recommendation': {
      const d = details as RecommendationDetails;
      return (
        <div className="journal-entry-details">
          <div className="detail-row">
            <span className="detail-label">Strategy:</span>
            <span className="detail-value">{d.strategyType}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Underlying:</span>
            <span className="detail-value">{d.underlying}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Confidence:</span>
            <span className={`badge badge--${d.confidence}`}>{d.confidence.toUpperCase()}</span>
          </div>
          {d.thesis.length > 0 && (
            <div className="detail-section">
              <span className="detail-label">Thesis:</span>
              <ul className="detail-list">
                {d.thesis.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          )}
          {d.catalysts.length > 0 && (
            <div className="detail-section">
              <span className="detail-label">Catalysts:</span>
              <ul className="detail-list">
                {d.catalysts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          {d.estimatedMaxLoss && (
            <div className="detail-row">
              <span className="detail-label">Max Loss:</span>
              <span className="detail-value text-negative">
                {formatCurrency(d.estimatedMaxLoss)} ({d.estimatedMaxLossPercent?.toFixed(1)}%)
              </span>
            </div>
          )}
        </div>
      );
    }

    case 'approval': {
      const d = details as ApprovalDetails;
      return (
        <div className="journal-entry-details">
          <div className="detail-row">
            <span className="detail-label">Strategy:</span>
            <span className="detail-value">{d.strategyType} on {d.underlying}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Orders:</span>
            <span className="detail-value">{d.orderCount}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Est. Cost:</span>
            <span className="detail-value">{formatCurrency(d.estimatedCost)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Risk Checks:</span>
            <span className={`badge ${d.riskChecksPassed ? 'badge--success' : 'badge--danger'}`}>
              {d.riskChecksPassed ? 'PASSED' : 'FAILED'}
            </span>
          </div>
          {d.warnings && d.warnings.length > 0 && (
            <div className="detail-section">
              <span className="detail-label">Warnings:</span>
              <ul className="detail-list detail-list--warning">
                {d.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      );
    }

    case 'rejection': {
      const d = details as RejectionDetails;
      return (
        <div className="journal-entry-details">
          <div className="detail-row">
            <span className="detail-label">Strategy:</span>
            <span className="detail-value">{d.strategyType} on {d.underlying}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Rejected By:</span>
            <span className="detail-value">{d.rejectedBy === 'user' ? 'User' : 'System'}</span>
          </div>
          {d.reason && (
            <div className="detail-row">
              <span className="detail-label">Reason:</span>
              <span className="detail-value">{d.reason}</span>
            </div>
          )}
          {d.failedChecks && d.failedChecks.length > 0 && (
            <div className="detail-section">
              <span className="detail-label">Failed Checks:</span>
              <ul className="detail-list detail-list--danger">
                {d.failedChecks.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      );
    }

    case 'execution': {
      const d = details as ExecutionDetails;
      return (
        <div className="journal-entry-details">
          <div className="detail-row">
            <span className="detail-label">Symbol:</span>
            <span className="detail-value">{d.symbol}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Side:</span>
            <span className={`badge ${d.side === 'buy' ? 'badge--buy' : 'badge--sell'}`}>
              {d.side.toUpperCase()}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Quantity:</span>
            <span className="detail-value">{d.quantity}</span>
          </div>
          {d.limitPrice && (
            <div className="detail-row">
              <span className="detail-label">Limit Price:</span>
              <span className="detail-value">{formatCurrency(d.limitPrice)}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Status:</span>
            <span className={`badge ${d.success ? 'badge--success' : 'badge--danger'}`}>
              {d.success ? 'SUCCESS' : 'FAILED'}
            </span>
          </div>
          {d.brokerOrderId && (
            <div className="detail-row">
              <span className="detail-label">Order ID:</span>
              <span className="detail-value font-mono">{d.brokerOrderId}</span>
            </div>
          )}
          {d.errorMessage && (
            <div className="detail-row">
              <span className="detail-label">Error:</span>
              <span className="detail-value text-negative">{d.errorMessage}</span>
            </div>
          )}
        </div>
      );
    }

    case 'cancellation': {
      const d = details as CancellationDetails;
      return (
        <div className="journal-entry-details">
          <div className="detail-row">
            <span className="detail-label">Symbol:</span>
            <span className="detail-value">{d.symbol}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Order ID:</span>
            <span className="detail-value font-mono">{d.brokerOrderId}</span>
          </div>
          {d.reason && (
            <div className="detail-row">
              <span className="detail-label">Reason:</span>
              <span className="detail-value">{d.reason}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Status:</span>
            <span className={`badge ${d.success ? 'badge--success' : 'badge--danger'}`}>
              {d.success ? 'CANCELED' : 'FAILED'}
            </span>
          </div>
        </div>
      );
    }

    case 'fill': {
      const d = details as FillDetails;
      return (
        <div className="journal-entry-details">
          <div className="detail-row">
            <span className="detail-label">Symbol:</span>
            <span className="detail-value">{d.symbol}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Filled:</span>
            <span className="detail-value">{d.filledQuantity} / {d.totalQuantity}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Fill Price:</span>
            <span className="detail-value">{formatCurrency(d.fillPrice)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Status:</span>
            <span className={`badge ${d.isComplete ? 'badge--success' : 'badge--warning'}`}>
              {d.isComplete ? 'COMPLETE' : 'PARTIAL'}
            </span>
          </div>
          {d.commission && (
            <div className="detail-row">
              <span className="detail-label">Commission:</span>
              <span className="detail-value">{formatCurrency(d.commission)}</span>
            </div>
          )}
        </div>
      );
    }

    case 'risk_check': {
      const d = details as RiskCheckDetails;
      return (
        <div className="journal-entry-details">
          <div className="detail-row">
            <span className="detail-label">Trigger:</span>
            <span className="detail-value">{d.trigger.replace('_', ' ')}</span>
          </div>
          {d.symbol && (
            <div className="detail-row">
              <span className="detail-label">Symbol:</span>
              <span className="detail-value">{d.symbol}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Result:</span>
            <span className={`badge ${d.passed ? 'badge--success' : 'badge--danger'}`}>
              {d.passed ? 'PASSED' : 'FAILED'} ({d.passedChecks}/{d.totalChecks})
            </span>
          </div>
          {d.checks.length > 0 && (
            <div className="detail-section">
              <span className="detail-label">Checks:</span>
              <div className="risk-checks-list">
                {d.checks.map((check, i) => (
                  <div key={i} className={`risk-check ${check.passed ? 'risk-check--pass' : 'risk-check--fail'}`}>
                    <span className="risk-check-icon">{check.passed ? '✓' : '✗'}</span>
                    <span className="risk-check-type">{check.checkType}</span>
                    <span className="risk-check-message">{check.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    default:
      return (
        <div className="journal-entry-details">
          <pre className="detail-json">{JSON.stringify(details, null, 2)}</pre>
        </div>
      );
  }
}

// ===========================================================================
// Journal Entry Card Component
// ===========================================================================

interface EntryCardProps {
  entry: StoredAuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
  onAddNote: (text: string) => Promise<void>;
  onUpdateNote: (noteId: string, text: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

function JournalEntryCard({
  entry,
  expanded,
  onToggle,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
}: EntryCardProps): React.ReactElement {
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setIsSaving(true);
    try {
      await onAddNote(noteText.trim());
      setNoteText('');
      setIsAddingNote(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateNote = async (noteId: string) => {
    if (!editNoteText.trim()) return;
    setIsSaving(true);
    try {
      await onUpdateNote(noteId, editNoteText.trim());
      setEditingNoteId(null);
      setEditNoteText('');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!window.confirm('Delete this note?')) return;
    setIsSaving(true);
    try {
      await onDeleteNote(noteId);
    } finally {
      setIsSaving(false);
    }
  };

  const startEditNote = (note: AuditEntryNote) => {
    setEditingNoteId(note.id);
    setEditNoteText(note.text);
  };

  return (
    <div className={`journal-entry-card ${expanded ? 'journal-entry-card--expanded' : ''}`}>
      <div className="journal-entry-header" onClick={onToggle}>
        <div className="journal-entry-icon" style={{ color: getEventTypeColor(entry.eventType) }}>
          <span className="icon-placeholder">{formatEventType(entry.eventType)[0]}</span>
        </div>
        <div className="journal-entry-info">
          <div className="journal-entry-title">
            <span className="event-type-badge" style={{ backgroundColor: getEventTypeColor(entry.eventType) }}>
              {formatEventType(entry.eventType)}
            </span>
            <span className="actor-badge">{formatActor(entry.actor)}</span>
          </div>
          <div className="journal-entry-summary">{entry.summary}</div>
          <div className="journal-entry-meta">
            <span className="entry-time">{formatTime(entry.timestamp)}</span>
            {entry.proposalId && <span className="entry-proposal">Proposal: {entry.proposalId.slice(0, 8)}...</span>}
            {entry.notes && entry.notes.length > 0 && (
              <span className="entry-notes-count">{entry.notes.length} note(s)</span>
            )}
          </div>
        </div>
        <div className="journal-entry-expand">
          <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {expanded && (
        <div className="journal-entry-body">
          {renderEntryDetails(entry)}

          {/* Notes Section */}
          <div className="journal-entry-notes">
            <div className="notes-header">
              <h4 className="notes-title">Notes</h4>
              {!isAddingNote && (
                <button
                  className="btn btn--small btn--secondary"
                  onClick={() => setIsAddingNote(true)}
                >
                  + Add Note
                </button>
              )}
            </div>

            {isAddingNote && (
              <div className="note-form">
                <textarea
                  className="note-input"
                  placeholder="Add your notes about this decision..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  disabled={isSaving}
                />
                <div className="note-form-actions">
                  <button
                    className="btn btn--small btn--primary"
                    onClick={handleAddNote}
                    disabled={!noteText.trim() || isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className="btn btn--small btn--secondary"
                    onClick={() => { setIsAddingNote(false); setNoteText(''); }}
                    disabled={isSaving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {entry.notes && entry.notes.length > 0 && (
              <div className="notes-list">
                {entry.notes.map((note) => (
                  <div key={note.id} className="note-item">
                    {editingNoteId === note.id ? (
                      <div className="note-form">
                        <textarea
                          className="note-input"
                          value={editNoteText}
                          onChange={(e) => setEditNoteText(e.target.value)}
                          rows={3}
                          disabled={isSaving}
                        />
                        <div className="note-form-actions">
                          <button
                            className="btn btn--small btn--primary"
                            onClick={() => handleUpdateNote(note.id)}
                            disabled={!editNoteText.trim() || isSaving}
                          >
                            {isSaving ? 'Saving...' : 'Update'}
                          </button>
                          <button
                            className="btn btn--small btn--secondary"
                            onClick={() => { setEditingNoteId(null); setEditNoteText(''); }}
                            disabled={isSaving}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="note-text">{note.text}</div>
                        <div className="note-meta">
                          <span className="note-date">
                            Added {formatTime(note.addedAt)}
                            {note.updatedAt && ` (edited ${formatTime(note.updatedAt)})`}
                          </span>
                          <div className="note-actions">
                            <button
                              className="btn btn--tiny btn--ghost"
                              onClick={() => startEditNote(note)}
                              title="Edit note"
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn--tiny btn--ghost btn--danger"
                              onClick={() => handleDeleteNote(note.id)}
                              title="Delete note"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {(!entry.notes || entry.notes.length === 0) && !isAddingNote && (
              <div className="notes-empty">No notes yet. Add your thoughts about this decision.</div>
            )}
          </div>

          {/* Data Sources */}
          {entry.dataSources && entry.dataSources.length > 0 && (
            <div className="journal-entry-sources">
              <h4 className="sources-title">Data Sources</h4>
              <div className="sources-list">
                {entry.dataSources.map((source, i) => (
                  <div key={i} className="source-item">
                    <span className="source-type">{source.sourceType}</span>
                    <span className="source-desc">{source.description}</span>
                    <span className="source-time">{formatTime(source.retrievedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Main Component
// ===========================================================================

export default function DecisionJournal({
  apiBaseUrl = 'http://localhost:3001',
  demoMode = false,
}: DecisionJournalProps): React.ReactElement {
  const [dayGroups, setDayGroups] = useState<DayGroup[]>([]);
  const [statistics, setStatistics] = useState<JournalStatistics | null>(null);
  const [filters, setFilters] = useState<JournalQueryOptions>({
    sortOrder: 'desc',
    limit: 100,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  // Fetch journal entries
  const fetchEntries = useCallback(async () => {
    if (demoMode) {
      setDayGroups(mockDayGroups);
      setStatistics(mockStatistics);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.eventTypes && filters.eventTypes.length > 0) {
        params.set('eventTypes', filters.eventTypes.join(','));
      }
      if (filters.actor) params.set('actor', filters.actor);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.limit) params.set('limit', filters.limit.toString());
      if (filters.offset) params.set('offset', filters.offset.toString());
      if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);

      const response = await fetch(`${apiBaseUrl}/api/journal/entries?${params}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch journal entries');
      }

      setDayGroups(result.data.dayGroups);
      setStatistics(result.data.statistics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal');
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, demoMode, filters]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Toggle entry expansion
  const toggleEntry = useCallback((entryId: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }, []);

  // Note handlers
  const handleAddNote = useCallback(async (entryId: string, text: string) => {
    if (demoMode) {
      // Update local state in demo mode
      setDayGroups((prev) =>
        prev.map((group) => ({
          ...group,
          entries: group.entries.map((entry) =>
            entry.id === entryId
              ? {
                  ...entry,
                  notes: [
                    ...(entry.notes ?? []),
                    {
                      id: `note-${Date.now()}`,
                      text,
                      addedAt: new Date().toISOString(),
                    },
                  ],
                }
              : entry
          ),
        }))
      );
      return;
    }

    const response = await fetch(`${apiBaseUrl}/api/journal/entries/${entryId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to add note');
    }
    await fetchEntries();
  }, [apiBaseUrl, demoMode, fetchEntries]);

  const handleUpdateNote = useCallback(async (entryId: string, noteId: string, text: string) => {
    if (demoMode) {
      setDayGroups((prev) =>
        prev.map((group) => ({
          ...group,
          entries: group.entries.map((entry) =>
            entry.id === entryId
              ? {
                  ...entry,
                  notes: entry.notes?.map((note) =>
                    note.id === noteId
                      ? { ...note, text, updatedAt: new Date().toISOString() }
                      : note
                  ),
                }
              : entry
          ),
        }))
      );
      return;
    }

    const response = await fetch(`${apiBaseUrl}/api/journal/entries/${entryId}/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to update note');
    }
    await fetchEntries();
  }, [apiBaseUrl, demoMode, fetchEntries]);

  const handleDeleteNote = useCallback(async (entryId: string, noteId: string) => {
    if (demoMode) {
      setDayGroups((prev) =>
        prev.map((group) => ({
          ...group,
          entries: group.entries.map((entry) =>
            entry.id === entryId
              ? { ...entry, notes: entry.notes?.filter((n) => n.id !== noteId) }
              : entry
          ),
        }))
      );
      return;
    }

    const response = await fetch(`${apiBaseUrl}/api/journal/entries/${entryId}/notes/${noteId}`, {
      method: 'DELETE',
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete note');
    }
    await fetchEntries();
  }, [apiBaseUrl, demoMode, fetchEntries]);

  // Filter handlers
  const handleEventTypeToggle = useCallback((eventType: AuditEventType) => {
    setFilters((prev) => {
      const currentTypes = prev.eventTypes ?? [];
      const hasType = currentTypes.includes(eventType);
      return {
        ...prev,
        eventTypes: hasType
          ? currentTypes.filter((t) => t !== eventType)
          : [...currentTypes, eventType],
      };
    });
  }, []);

  const handleDateRangeChange = useCallback((startDate: string, endDate: string) => {
    setFilters((prev) => ({
      ...prev,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({
      sortOrder: 'desc',
      limit: 100,
    });
  }, []);

  // Count total entries
  const totalEntries = dayGroups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <div className="section decision-journal">
      <div className="section-header">
        <h2 className="section-title">Decision Journal</h2>
        <div className="journal-header-actions">
          <button className="btn btn--small" onClick={fetchEntries} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Statistics Summary */}
      {statistics && (
        <div className="journal-stats">
          <div className="stat-item">
            <span className="stat-value">{statistics.total}</span>
            <span className="stat-label">Total Events</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{statistics.byEventType.recommendation || 0}</span>
            <span className="stat-label">Recommendations</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{statistics.byEventType.execution || 0}</span>
            <span className="stat-label">Executions</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{statistics.byEventType.fill || 0}</span>
            <span className="stat-label">Fills</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="journal-filters">
        <div className="filters-row">
          <div className="filter-group">
            <label className="filter-label">Event Types:</label>
            <div className="filter-chips">
              {EVENT_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={`filter-chip ${filters.eventTypes?.includes(option.value) ? 'filter-chip--active' : ''}`}
                  onClick={() => handleEventTypeToggle(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="filters-row">
          <div className="filter-group">
            <label className="filter-label">Date Range:</label>
            <input
              type="date"
              className="filter-input"
              value={filters.startDate ?? ''}
              onChange={(e) => handleDateRangeChange(e.target.value, filters.endDate ?? '')}
            />
            <span className="filter-separator">to</span>
            <input
              type="date"
              className="filter-input"
              value={filters.endDate ?? ''}
              onChange={(e) => handleDateRangeChange(filters.startDate ?? '', e.target.value)}
            />
          </div>
          {(filters.eventTypes?.length || filters.startDate || filters.endDate) && (
            <button className="btn btn--small btn--ghost" onClick={handleClearFilters}>
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="journal-error">
          <span className="error-icon">!</span>
          <span>{error}</span>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="journal-loading">
          <div className="loading-spinner" />
          <span>Loading journal entries...</span>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && totalEntries === 0 && (
        <div className="journal-empty">
          <div className="empty-icon">📔</div>
          <h3>No Journal Entries</h3>
          <p>Your decision journal is empty. Entries will appear here as you make trading decisions.</p>
        </div>
      )}

      {/* Journal Entries by Day */}
      {!isLoading && !error && totalEntries > 0 && (
        <div className="journal-entries">
          {dayGroups.map((group) => (
            <div key={group.date} className="journal-day-group">
              <div className="day-header">
                <h3 className="day-title">{formatDate(group.date)}</h3>
                <span className="day-count">{group.entries.length} event(s)</span>
              </div>
              <div className="day-entries">
                {group.entries.map((entry) => (
                  <JournalEntryCard
                    key={entry.id}
                    entry={entry}
                    expanded={expandedEntries.has(entry.id)}
                    onToggle={() => toggleEntry(entry.id)}
                    onAddNote={(text) => handleAddNote(entry.id, text)}
                    onUpdateNote={(noteId, text) => handleUpdateNote(entry.id, noteId, text)}
                    onDeleteNote={(noteId) => handleDeleteNote(entry.id, noteId)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
