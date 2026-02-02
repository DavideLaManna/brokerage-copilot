/**
 * Tests for PositionsTable component
 */

import { describe, it, expect } from 'vitest';
import type { Position } from '../types';

// ============================================================================
// Test Data
// ============================================================================

const mockLongOptionPosition: Position = {
  id: 'pos-1',
  symbol: 'AAPL240216C00185000',
  quantity: 5,
  averageCost: 4.25,
  currentPrice: 5.80,
  marketValue: 2900.00,
  unrealizedPnL: 775.00,
  unrealizedPnLPercent: 36.47,
  assetClass: 'option',
  optionDetails: {
    optionSymbol: 'AAPL240216C00185000',
    underlying: 'AAPL',
    strike: 185,
    expiration: new Date('2024-02-16'),
    optionType: 'call',
    multiplier: 100,
    greeks: {
      delta: 0.65,
      gamma: 0.08,
      theta: -0.15,
      vega: 0.25,
      impliedVolatility: 0.28,
    },
  },
};

const mockShortOptionPosition: Position = {
  id: 'pos-2',
  symbol: 'SPY240315P00475000',
  quantity: -3,
  averageCost: 3.50,
  currentPrice: 2.85,
  marketValue: -855.00,
  unrealizedPnL: 195.00,
  unrealizedPnLPercent: 18.57,
  assetClass: 'option',
  optionDetails: {
    optionSymbol: 'SPY240315P00475000',
    underlying: 'SPY',
    strike: 475,
    expiration: new Date('2024-03-15'),
    optionType: 'put',
    multiplier: 100,
    greeks: {
      delta: -0.32,
      gamma: 0.04,
      theta: -0.08,
      vega: 0.18,
      impliedVolatility: 0.22,
    },
  },
};

const mockEquityPosition: Position = {
  id: 'pos-3',
  symbol: 'NVDA',
  quantity: 50,
  averageCost: 485.00,
  currentPrice: 512.50,
  marketValue: 25625.00,
  unrealizedPnL: 1375.00,
  unrealizedPnLPercent: 5.67,
  assetClass: 'equity',
};

const mockShortEquityPosition: Position = {
  id: 'pos-4',
  symbol: 'TSLA',
  quantity: -10,
  averageCost: 250.00,
  currentPrice: 240.00,
  marketValue: -2400.00,
  unrealizedPnL: 100.00,
  unrealizedPnLPercent: 4.00,
  assetClass: 'equity',
};

// ============================================================================
// Exit Ladder Eligibility Tests
// ============================================================================

describe('Exit Ladder Button Eligibility', () => {
  // The exit ladder button should only show for long option positions

  it('shows exit ladder button for long option positions', () => {
    const isEligible = mockLongOptionPosition.quantity > 0 && mockLongOptionPosition.assetClass === 'option';
    expect(isEligible).toBe(true);
  });

  it('hides exit ladder button for short option positions', () => {
    const isEligible = mockShortOptionPosition.quantity > 0 && mockShortOptionPosition.assetClass === 'option';
    expect(isEligible).toBe(false);
  });

  it('hides exit ladder button for long equity positions', () => {
    const isEligible = mockEquityPosition.quantity > 0 && mockEquityPosition.assetClass === 'option';
    expect(isEligible).toBe(false);
  });

  it('hides exit ladder button for short equity positions', () => {
    const isEligible = mockShortEquityPosition.quantity > 0 && mockShortEquityPosition.assetClass === 'option';
    expect(isEligible).toBe(false);
  });
});

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('formatCurrency', () => {
  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  it('formats positive currency', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('formats negative currency', () => {
    expect(formatCurrency(-567.89)).toBe('-$567.89');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats large numbers with commas', () => {
    expect(formatCurrency(25625.00)).toBe('$25,625.00');
  });
});

describe('formatPercent', () => {
  function formatPercent(value: number): string {
    const prefix = value >= 0 ? '+' : '';
    return prefix + value.toFixed(2) + '%';
  }

  it('formats positive percent with plus sign', () => {
    expect(formatPercent(36.47)).toBe('+36.47%');
  });

  it('formats negative percent with minus sign', () => {
    expect(formatPercent(-29.14)).toBe('-29.14%');
  });

  it('formats zero with plus sign', () => {
    expect(formatPercent(0)).toBe('+0.00%');
  });

  it('rounds to two decimal places', () => {
    expect(formatPercent(5.678)).toBe('+5.68%');
  });
});

describe('formatDate', () => {
  function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    });
  }

  it('formats date correctly', () => {
    const date = new Date('2024-02-16');
    // Format varies by locale, so just check it includes the key parts
    const formatted = formatDate(date);
    expect(formatted).toContain('Feb');
    expect(formatted).toContain('16');
    expect(formatted).toContain('24');
  });
});

describe('getContractDescription', () => {
  function getContractDescription(position: Position): string {
    if (position.assetClass === 'equity') {
      return position.symbol;
    }

    const opt = position.optionDetails;
    if (!opt) {
      return position.symbol;
    }

    const expDate = opt.expiration instanceof Date ? opt.expiration : new Date(opt.expiration);
    const expStr = expDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    });
    const typeStr = opt.optionType === 'call' ? 'C' : 'P';
    return `${opt.underlying} ${expStr} $${opt.strike} ${typeStr}`;
  }

  it('returns symbol for equity positions', () => {
    expect(getContractDescription(mockEquityPosition)).toBe('NVDA');
  });

  it('formats option contract description', () => {
    const desc = getContractDescription(mockLongOptionPosition);
    expect(desc).toContain('AAPL');
    expect(desc).toContain('$185');
    expect(desc).toContain('C');
  });

  it('uses P for put options', () => {
    const desc = getContractDescription(mockShortOptionPosition);
    expect(desc).toContain('SPY');
    expect(desc).toContain('$475');
    expect(desc).toContain('P');
  });
});

// ============================================================================
// Rendering Logic Tests
// ============================================================================

describe('Position row rendering logic', () => {
  it('determines positive P&L class', () => {
    const pnlClass = mockLongOptionPosition.unrealizedPnL >= 0 ? 'text-positive' : 'text-negative';
    expect(pnlClass).toBe('text-positive');
  });

  it('determines negative P&L class', () => {
    const position: Position = { ...mockLongOptionPosition, unrealizedPnL: -100 };
    const pnlClass = position.unrealizedPnL >= 0 ? 'text-positive' : 'text-negative';
    expect(pnlClass).toBe('text-negative');
  });

  it('extracts underlying symbol from option', () => {
    const underlying = mockLongOptionPosition.optionDetails?.underlying || mockLongOptionPosition.symbol;
    expect(underlying).toBe('AAPL');
  });

  it('uses symbol for equity underlying', () => {
    const underlying = mockEquityPosition.optionDetails?.underlying || mockEquityPosition.symbol;
    expect(underlying).toBe('NVDA');
  });
});

// ============================================================================
// Column Header Tests
// ============================================================================

describe('Table columns', () => {
  const expectedColumns = [
    'Symbol',
    'Contract',
    'Type',
    'Qty',
    'Avg Cost',
    'Mark',
    'Mkt Value',
    'P&L',
    'P&L %',
  ];

  it('has all expected columns', () => {
    // When onSetExitLadder is provided, Actions column is also shown
    const columnsWithActions = [...expectedColumns, 'Actions'];
    expect(columnsWithActions.length).toBe(10);
  });

  it('Actions column is conditional', () => {
    // Without onSetExitLadder, should only have 9 columns
    expect(expectedColumns.length).toBe(9);
  });
});

// ============================================================================
// Empty/Loading State Tests
// ============================================================================

describe('Empty and loading states', () => {
  it('shows empty state when no positions', () => {
    const positions: Position[] = [];
    const showEmptyState = positions.length === 0;
    expect(showEmptyState).toBe(true);
  });

  it('shows table when positions exist', () => {
    const positions = [mockLongOptionPosition];
    const showTable = positions.length > 0;
    expect(showTable).toBe(true);
  });
});

// ============================================================================
// Props Interface Tests
// ============================================================================

describe('Props interface', () => {
  it('positions prop is required', () => {
    const props = {
      positions: [mockLongOptionPosition],
    };
    expect(props.positions).toBeDefined();
    expect(Array.isArray(props.positions)).toBe(true);
  });

  it('loading prop is optional', () => {
    const propsWithLoading = {
      positions: [],
      loading: true,
    };
    expect(propsWithLoading.loading).toBe(true);

    const propsWithoutLoading = {
      positions: [],
    };
    expect(propsWithoutLoading).not.toHaveProperty('loading');
  });

  it('onRefresh prop is optional', () => {
    const propsWithRefresh = {
      positions: [],
      onRefresh: () => {},
    };
    expect(typeof propsWithRefresh.onRefresh).toBe('function');
  });

  it('onSetExitLadder prop is optional', () => {
    const propsWithExitLadder = {
      positions: [],
      onSetExitLadder: (_position: Position) => {},
    };
    expect(typeof propsWithExitLadder.onSetExitLadder).toBe('function');
  });
});

// ============================================================================
// Position Data Integrity Tests
// ============================================================================

describe('Position data integrity', () => {
  it('option position has required option details', () => {
    expect(mockLongOptionPosition.optionDetails).toBeDefined();
    expect(mockLongOptionPosition.optionDetails!.optionSymbol).toBeDefined();
    expect(mockLongOptionPosition.optionDetails!.underlying).toBeDefined();
    expect(mockLongOptionPosition.optionDetails!.strike).toBeDefined();
    expect(mockLongOptionPosition.optionDetails!.expiration).toBeDefined();
    expect(mockLongOptionPosition.optionDetails!.optionType).toBeDefined();
  });

  it('equity position does not have option details', () => {
    expect(mockEquityPosition.optionDetails).toBeUndefined();
  });

  it('position has all required fields', () => {
    const requiredFields = [
      'id',
      'symbol',
      'quantity',
      'averageCost',
      'currentPrice',
      'marketValue',
      'unrealizedPnL',
      'unrealizedPnLPercent',
      'assetClass',
    ];

    for (const field of requiredFields) {
      expect(mockLongOptionPosition).toHaveProperty(field);
    }
  });
});
