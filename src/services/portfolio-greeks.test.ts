/**
 * Portfolio Greeks Service Tests
 */

import { describe, it, expect } from 'vitest';
import type { Position } from '../types/broker.js';
import {
  calculatePortfolioGreeks,
  calculateDetailedPortfolioGreeks,
  formatGreekValue,
  formatPortfolioGreeksForDisplay,
  getGreeksInterpretation,
  checkGreeksRisk,
  type PortfolioGreeks,
} from './portfolio-greeks.js';

// ============================================================================
// Test Data
// ============================================================================

const createOptionPosition = (
  id: string,
  symbol: string,
  underlying: string,
  quantity: number,
  optionType: 'call' | 'put',
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number },
  multiplier: number = 100
): Position => ({
  id,
  symbol,
  quantity,
  averageCost: 5.0,
  currentPrice: 5.5,
  marketValue: quantity * 5.5 * multiplier,
  unrealizedPnL: quantity * 0.5 * multiplier,
  unrealizedPnLPercent: 10,
  assetClass: 'option',
  optionDetails: {
    optionSymbol: symbol,
    underlying,
    strike: 100,
    expiration: new Date('2024-03-15'),
    optionType,
    multiplier,
    greeks,
  },
});

const createEquityPosition = (
  id: string,
  symbol: string,
  quantity: number
): Position => ({
  id,
  symbol,
  quantity,
  averageCost: 100,
  currentPrice: 105,
  marketValue: quantity * 105,
  unrealizedPnL: quantity * 5,
  unrealizedPnLPercent: 5,
  assetClass: 'equity',
});

// ============================================================================
// calculatePortfolioGreeks Tests
// ============================================================================

describe('calculatePortfolioGreeks', () => {
  it('should return zero Greeks for empty positions array', () => {
    const result = calculatePortfolioGreeks([]);

    expect(result.delta).toBe(0);
    expect(result.gamma).toBe(0);
    expect(result.theta).toBe(0);
    expect(result.vega).toBe(0);
    expect(result.totalOptionPositions).toBe(0);
    expect(result.positionsWithGreeks).toBe(0);
    expect(result.positionsWithoutGreeks).toBe(0);
  });

  it('should calculate aggregate Greeks for single long call position', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 5, 'call', {
        delta: 0.5,
        gamma: 0.05,
        theta: -0.10,
        vega: 0.20,
      }),
    ];

    const result = calculatePortfolioGreeks(positions);

    // 5 contracts * 100 multiplier * Greeks
    expect(result.delta).toBe(250); // 5 * 100 * 0.5
    expect(result.gamma).toBe(25);  // 5 * 100 * 0.05
    expect(result.theta).toBe(-50); // 5 * 100 * -0.10
    expect(result.vega).toBe(100);  // 5 * 100 * 0.20
    expect(result.positionsWithGreeks).toBe(1);
    expect(result.positionsWithoutGreeks).toBe(0);
    expect(result.totalOptionPositions).toBe(1);
  });

  it('should calculate aggregate Greeks for short put position', () => {
    const positions = [
      createOptionPosition('1', 'SPY240315P00475000', 'SPY', -3, 'put', {
        delta: -0.3,
        gamma: 0.04,
        theta: -0.08,
        vega: 0.15,
      }),
    ];

    const result = calculatePortfolioGreeks(positions);

    // -3 contracts * 100 multiplier * Greeks
    // Short puts have negative delta that becomes positive when short
    expect(result.delta).toBe(90);   // -3 * 100 * -0.3 = 90 (short put = positive delta)
    expect(result.gamma).toBe(-12);  // -3 * 100 * 0.04
    expect(result.theta).toBe(24);   // -3 * 100 * -0.08 (positive theta from short)
    expect(result.vega).toBe(-45);   // -3 * 100 * 0.15
  });

  it('should aggregate Greeks across multiple positions', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 10, 'call', {
        delta: 0.6,
        gamma: 0.08,
        theta: -0.15,
        vega: 0.25,
      }),
      createOptionPosition('2', 'AAPL240315P00090000', 'AAPL', -5, 'put', {
        delta: -0.3,
        gamma: 0.05,
        theta: -0.10,
        vega: 0.18,
      }),
      createOptionPosition('3', 'SPY240315C00500000', 'SPY', 2, 'call', {
        delta: 0.45,
        gamma: 0.03,
        theta: -0.20,
        vega: 0.30,
      }),
    ];

    const result = calculatePortfolioGreeks(positions);

    // Position 1: 10 * 100 * Greeks
    // Position 2: -5 * 100 * Greeks
    // Position 3: 2 * 100 * Greeks
    const expectedDelta = (10 * 100 * 0.6) + (-5 * 100 * -0.3) + (2 * 100 * 0.45);
    const expectedGamma = (10 * 100 * 0.08) + (-5 * 100 * 0.05) + (2 * 100 * 0.03);
    const expectedTheta = (10 * 100 * -0.15) + (-5 * 100 * -0.10) + (2 * 100 * -0.20);
    const expectedVega = (10 * 100 * 0.25) + (-5 * 100 * 0.18) + (2 * 100 * 0.30);

    expect(result.delta).toBe(Math.round(expectedDelta * 100) / 100);
    expect(result.gamma).toBe(Math.round(expectedGamma * 100) / 100);
    expect(result.theta).toBe(Math.round(expectedTheta * 100) / 100);
    expect(result.vega).toBe(Math.round(expectedVega * 100) / 100);
    expect(result.positionsWithGreeks).toBe(3);
  });

  it('should skip equity positions', () => {
    const positions = [
      createEquityPosition('1', 'AAPL', 100),
      createOptionPosition('2', 'AAPL240315C00100000', 'AAPL', 5, 'call', {
        delta: 0.5,
        gamma: 0.05,
        theta: -0.10,
        vega: 0.20,
      }),
    ];

    const result = calculatePortfolioGreeks(positions);

    expect(result.totalOptionPositions).toBe(1);
    expect(result.delta).toBe(250);
  });

  it('should handle positions without Greeks (mark as N/A)', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 5, 'call', {
        delta: 0.5,
        gamma: 0.05,
        theta: -0.10,
        vega: 0.20,
      }),
      createOptionPosition('2', 'AAPL240315P00090000', 'AAPL', 3, 'put', undefined),
    ];

    const result = calculatePortfolioGreeks(positions);

    expect(result.positionsWithGreeks).toBe(1);
    expect(result.positionsWithoutGreeks).toBe(1);
    expect(result.totalOptionPositions).toBe(2);
    // Only includes Greeks from position with data
    expect(result.delta).toBe(250);
  });

  it('should handle positions with partial Greeks', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 5, 'call', {
        delta: 0.5,
        // gamma, theta, vega undefined
      }),
    ];

    const result = calculatePortfolioGreeks(positions);

    expect(result.delta).toBe(250);
    expect(result.gamma).toBe(0); // No gamma provided
    expect(result.theta).toBe(0); // No theta provided
    expect(result.vega).toBe(0);  // No vega provided
    expect(result.positionsWithGreeks).toBe(1);
  });

  it('should handle empty Greeks object as position without Greeks', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 5, 'call', {}),
    ];

    const result = calculatePortfolioGreeks(positions);

    expect(result.positionsWithGreeks).toBe(0);
    expect(result.positionsWithoutGreeks).toBe(1);
    expect(result.delta).toBe(0);
  });

  it('should include calculatedAt timestamp', () => {
    const before = new Date();
    const result = calculatePortfolioGreeks([]);
    const after = new Date();

    expect(result.calculatedAt).toBeInstanceOf(Date);
    expect(result.calculatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.calculatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// calculateDetailedPortfolioGreeks Tests
// ============================================================================

describe('calculateDetailedPortfolioGreeks', () => {
  it('should provide position-level breakdown', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 5, 'call', {
        delta: 0.5,
        gamma: 0.05,
        theta: -0.10,
        vega: 0.20,
      }),
    ];

    const result = calculateDetailedPortfolioGreeks(positions);

    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].positionId).toBe('1');
    expect(result.breakdown[0].symbol).toBe('AAPL240315C00100000');
    expect(result.breakdown[0].underlying).toBe('AAPL');
    expect(result.breakdown[0].quantity).toBe(5);
    expect(result.breakdown[0].multiplier).toBe(100);
    expect(result.breakdown[0].hasGreeks).toBe(true);
    expect(result.breakdown[0].adjustedDelta).toBe(250);
    expect(result.breakdown[0].adjustedGamma).toBe(25);
    expect(result.breakdown[0].adjustedTheta).toBe(-50);
    expect(result.breakdown[0].adjustedVega).toBe(100);
  });

  it('should group Greeks by underlying', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 5, 'call', {
        delta: 0.5,
        gamma: 0.05,
        theta: -0.10,
        vega: 0.20,
      }),
      createOptionPosition('2', 'AAPL240315P00090000', 'AAPL', -3, 'put', {
        delta: -0.3,
        gamma: 0.04,
        theta: -0.08,
        vega: 0.15,
      }),
      createOptionPosition('3', 'SPY240315C00500000', 'SPY', 2, 'call', {
        delta: 0.45,
        gamma: 0.03,
        theta: -0.20,
        vega: 0.30,
      }),
    ];

    const result = calculateDetailedPortfolioGreeks(positions);

    expect(result.byUnderlying.size).toBe(2);
    expect(result.byUnderlying.has('AAPL')).toBe(true);
    expect(result.byUnderlying.has('SPY')).toBe(true);

    const aaplGreeks = result.byUnderlying.get('AAPL')!;
    expect(aaplGreeks.totalOptionPositions).toBe(2);

    const spyGreeks = result.byUnderlying.get('SPY')!;
    expect(spyGreeks.totalOptionPositions).toBe(1);
    expect(spyGreeks.delta).toBe(90); // 2 * 100 * 0.45
  });

  it('should mark positions without Greeks appropriately', () => {
    const positions = [
      createOptionPosition('1', 'AAPL240315C00100000', 'AAPL', 5, 'call', undefined),
    ];

    const result = calculateDetailedPortfolioGreeks(positions);

    expect(result.breakdown[0].hasGreeks).toBe(false);
    expect(result.breakdown[0].adjustedDelta).toBeNull();
    expect(result.breakdown[0].adjustedGamma).toBeNull();
    expect(result.breakdown[0].adjustedTheta).toBeNull();
    expect(result.breakdown[0].adjustedVega).toBeNull();
  });
});

// ============================================================================
// formatGreekValue Tests
// ============================================================================

describe('formatGreekValue', () => {
  it('should format available values with specified decimals', () => {
    const result = formatGreekValue(123.456, 2);

    expect(result.value).toBe(123.456);
    expect(result.display).toBe('123.46');
    expect(result.available).toBe(true);
  });

  it('should return N/A for undefined values', () => {
    const result = formatGreekValue(undefined);

    expect(result.value).toBeNull();
    expect(result.display).toBe('N/A');
    expect(result.available).toBe(false);
  });

  it('should return N/A for null values', () => {
    const result = formatGreekValue(null);

    expect(result.value).toBeNull();
    expect(result.display).toBe('N/A');
    expect(result.available).toBe(false);
  });

  it('should format zero correctly', () => {
    const result = formatGreekValue(0);

    expect(result.value).toBe(0);
    expect(result.display).toBe('0.00');
    expect(result.available).toBe(true);
  });

  it('should format negative values correctly', () => {
    const result = formatGreekValue(-45.678, 1);

    expect(result.value).toBe(-45.678);
    expect(result.display).toBe('-45.7');
    expect(result.available).toBe(true);
  });
});

// ============================================================================
// formatPortfolioGreeksForDisplay Tests
// ============================================================================

describe('formatPortfolioGreeksForDisplay', () => {
  it('should format all Greeks for display', () => {
    const greeks: PortfolioGreeks = {
      delta: 250.5,
      gamma: -25.3,
      theta: -50.0,
      vega: 100.75,
      positionsWithGreeks: 3,
      positionsWithoutGreeks: 1,
      totalOptionPositions: 4,
      calculatedAt: new Date(),
    };

    const result = formatPortfolioGreeksForDisplay(greeks);

    expect(result['Delta']).toBe('+250.50');
    expect(result['Gamma']).toBe('-25.30');
    expect(result['Theta']).toBe('-50.00');
    expect(result['Vega']).toBe('+100.75');
    expect(result['Positions with Greeks']).toBe('3');
    expect(result['Positions without Greeks']).toBe('1');
    expect(result['Total Option Positions']).toBe('4');
  });
});

// ============================================================================
// getGreeksInterpretation Tests
// ============================================================================

describe('getGreeksInterpretation', () => {
  it('should describe large positive delta exposure', () => {
    const greeks: PortfolioGreeks = {
      delta: 500,
      gamma: 10,
      theta: -20,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    expect(hints.some(h => h.includes('500') && h.includes('long'))).toBe(true);
  });

  it('should describe large negative delta exposure', () => {
    const greeks: PortfolioGreeks = {
      delta: -300,
      gamma: 10,
      theta: -20,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    expect(hints.some(h => h.includes('300') && h.includes('short'))).toBe(true);
  });

  it('should indicate delta-neutral portfolio', () => {
    const greeks: PortfolioGreeks = {
      delta: 5,
      gamma: 10,
      theta: -20,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    expect(hints.some(h => h.includes('delta-neutral'))).toBe(true);
  });

  it('should describe negative theta (time decay cost)', () => {
    const greeks: PortfolioGreeks = {
      delta: 100,
      gamma: 10,
      theta: -100,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    expect(hints.some(h => h.includes('$100') && h.includes('decay'))).toBe(true);
  });

  it('should describe positive theta (premium collection)', () => {
    const greeks: PortfolioGreeks = {
      delta: 100,
      gamma: -10,
      theta: 75,
      vega: -50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    expect(hints.some(h => h.includes('$75') && h.includes('decay'))).toBe(true);
  });

  it('should describe vega sensitivity', () => {
    const greeks: PortfolioGreeks = {
      delta: 100,
      gamma: 10,
      theta: -20,
      vega: 200,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    expect(hints.some(h => h.includes('$200') && h.includes('IV'))).toBe(true);
  });

  it('should warn about positions missing Greeks', () => {
    const greeks: PortfolioGreeks = {
      delta: 100,
      gamma: 10,
      theta: -20,
      vega: 50,
      positionsWithGreeks: 3,
      positionsWithoutGreeks: 2,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    expect(hints.some(h => h.includes('missing') && h.includes('2'))).toBe(true);
  });

  it('should return empty array for small neutral portfolio', () => {
    const greeks: PortfolioGreeks = {
      delta: 5,
      gamma: 5,
      theta: -5,
      vega: 5,
      positionsWithGreeks: 1,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 1,
      calculatedAt: new Date(),
    };

    const hints = getGreeksInterpretation(greeks);

    // Should still show delta-neutral hint
    expect(hints.some(h => h.includes('delta-neutral'))).toBe(true);
  });
});

// ============================================================================
// checkGreeksRisk Tests
// ============================================================================

describe('checkGreeksRisk', () => {
  it('should detect high delta risk', () => {
    const greeks: PortfolioGreeks = {
      delta: 1500,
      gamma: 10,
      theta: -20,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const result = checkGreeksRisk(greeks);

    expect(result.highDeltaRisk).toBe(true);
    expect(result.hasRisk).toBe(true);
  });

  it('should detect high gamma risk', () => {
    const greeks: PortfolioGreeks = {
      delta: 100,
      gamma: 600,
      theta: -20,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const result = checkGreeksRisk(greeks);

    expect(result.highGammaRisk).toBe(true);
    expect(result.hasRisk).toBe(true);
  });

  it('should detect high theta risk', () => {
    const greeks: PortfolioGreeks = {
      delta: 100,
      gamma: 10,
      theta: -300,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const result = checkGreeksRisk(greeks);

    expect(result.highThetaRisk).toBe(true);
    expect(result.hasRisk).toBe(true);
  });

  it('should detect high vega risk', () => {
    const greeks: PortfolioGreeks = {
      delta: 100,
      gamma: 10,
      theta: -20,
      vega: 600,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const result = checkGreeksRisk(greeks);

    expect(result.highVegaRisk).toBe(true);
    expect(result.hasRisk).toBe(true);
  });

  it('should return no risk for moderate Greeks', () => {
    const greeks: PortfolioGreeks = {
      delta: 200,
      gamma: 50,
      theta: -50,
      vega: 100,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const result = checkGreeksRisk(greeks);

    expect(result.highDeltaRisk).toBe(false);
    expect(result.highGammaRisk).toBe(false);
    expect(result.highThetaRisk).toBe(false);
    expect(result.highVegaRisk).toBe(false);
    expect(result.hasRisk).toBe(false);
  });

  it('should use custom thresholds', () => {
    const greeks: PortfolioGreeks = {
      delta: 200,
      gamma: 50,
      theta: -50,
      vega: 100,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const result = checkGreeksRisk(greeks, {
      maxAbsDelta: 100,
      maxAbsGamma: 25,
      maxNegativeTheta: -25,
      maxAbsVega: 50,
    });

    expect(result.highDeltaRisk).toBe(true);
    expect(result.highGammaRisk).toBe(true);
    expect(result.highThetaRisk).toBe(true);
    expect(result.highVegaRisk).toBe(true);
    expect(result.hasRisk).toBe(true);
  });

  it('should handle negative delta correctly', () => {
    const greeks: PortfolioGreeks = {
      delta: -1500,
      gamma: 10,
      theta: -20,
      vega: 50,
      positionsWithGreeks: 5,
      positionsWithoutGreeks: 0,
      totalOptionPositions: 5,
      calculatedAt: new Date(),
    };

    const result = checkGreeksRisk(greeks);

    expect(result.highDeltaRisk).toBe(true);
  });
});
