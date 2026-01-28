/**
 * Tests for OrderApprovalModal component helper functions
 */

import { describe, it, expect } from 'vitest';
import {
  formatStrategyType,
  formatConfidence,
  formatRiskCheckType,
  formatCurrency,
  formatDate,
  getConfidenceBadgeClass,
  type StrategyType,
  type ConfidenceLevel,
  type RiskCheckType,
  type OrderApprovalData,
  type DraftOrderInfo,
  type TradeProposalInfo,
  type OrderValidationResult,
  type RiskCheckResult,
} from './OrderApprovalModal.js';

describe('OrderApprovalModal Helper Functions', () => {
  describe('formatStrategyType', () => {
    it('should format long_call', () => {
      expect(formatStrategyType('long_call')).toBe('Long Call');
    });

    it('should format long_put', () => {
      expect(formatStrategyType('long_put')).toBe('Long Put');
    });

    it('should format short_call', () => {
      expect(formatStrategyType('short_call')).toBe('Short Call');
    });

    it('should format short_put', () => {
      expect(formatStrategyType('short_put')).toBe('Short Put');
    });

    it('should format covered_call', () => {
      expect(formatStrategyType('covered_call')).toBe('Covered Call');
    });

    it('should format cash_secured_put', () => {
      expect(formatStrategyType('cash_secured_put')).toBe('Cash-Secured Put');
    });

    it('should format vertical_spread', () => {
      expect(formatStrategyType('vertical_spread')).toBe('Vertical Spread');
    });

    it('should format calendar_spread', () => {
      expect(formatStrategyType('calendar_spread')).toBe('Calendar Spread');
    });

    it('should format iron_condor', () => {
      expect(formatStrategyType('iron_condor')).toBe('Iron Condor');
    });

    it('should format straddle', () => {
      expect(formatStrategyType('straddle')).toBe('Straddle');
    });

    it('should format strangle', () => {
      expect(formatStrategyType('strangle')).toBe('Strangle');
    });

    it('should format custom', () => {
      expect(formatStrategyType('custom')).toBe('Custom Strategy');
    });
  });

  describe('formatConfidence', () => {
    it('should format low confidence', () => {
      expect(formatConfidence('low')).toBe('Low');
    });

    it('should format medium confidence', () => {
      expect(formatConfidence('medium')).toBe('Medium');
    });

    it('should format high confidence', () => {
      expect(formatConfidence('high')).toBe('High');
    });
  });

  describe('formatRiskCheckType', () => {
    it('should format risk_per_trade', () => {
      expect(formatRiskCheckType('risk_per_trade')).toBe('Risk per Trade');
    });

    it('should format concentration', () => {
      expect(formatRiskCheckType('concentration')).toBe('Concentration');
    });

    it('should format buying_power', () => {
      expect(formatRiskCheckType('buying_power')).toBe('Buying Power');
    });

    it('should format dte_range', () => {
      expect(formatRiskCheckType('dte_range')).toBe('DTE Range');
    });

    it('should format liquidity', () => {
      expect(formatRiskCheckType('liquidity')).toBe('Liquidity');
    });

    it('should format max_positions', () => {
      expect(formatRiskCheckType('max_positions')).toBe('Max Positions');
    });

    it('should format max_contracts', () => {
      expect(formatRiskCheckType('max_contracts')).toBe('Max Contracts');
    });
  });

  describe('formatCurrency', () => {
    it('should format positive values', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });

    it('should format negative values as absolute', () => {
      expect(formatCurrency(-500.00)).toBe('$500.00');
    });

    it('should format zero', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('should format large values with commas', () => {
      expect(formatCurrency(1000000)).toBe('$1,000,000.00');
    });

    it('should format small decimal values', () => {
      expect(formatCurrency(0.05)).toBe('$0.05');
    });
  });

  describe('formatDate', () => {
    it('should format ISO date string', () => {
      const result = formatDate('2024-02-16T00:00:00.000Z');
      // Format: "Feb 16, '24"
      expect(result).toContain('Feb');
      expect(result).toContain('16');
      expect(result).toContain('24');
    });

    it('should format date string without time', () => {
      const result = formatDate('2024-12-31');
      expect(result).toContain('Dec');
      expect(result).toContain('31');
    });
  });

  describe('getConfidenceBadgeClass', () => {
    it('should return high confidence class', () => {
      expect(getConfidenceBadgeClass('high')).toBe('badge--confidence-high');
    });

    it('should return medium confidence class', () => {
      expect(getConfidenceBadgeClass('medium')).toBe('badge--confidence-medium');
    });

    it('should return low confidence class', () => {
      expect(getConfidenceBadgeClass('low')).toBe('badge--confidence-low');
    });
  });
});

describe('OrderApprovalModal Types', () => {
  describe('RiskCheckResult', () => {
    it('should allow valid RiskCheckResult with all fields', () => {
      const result: RiskCheckResult = {
        checkType: 'risk_per_trade',
        passed: true,
        message: 'Risk check passed',
        details: {
          actual: 1.5,
          limit: 2.0,
          unit: '%',
        },
      };
      expect(result.checkType).toBe('risk_per_trade');
      expect(result.passed).toBe(true);
      expect(result.details?.actual).toBe(1.5);
    });

    it('should allow RiskCheckResult without details', () => {
      const result: RiskCheckResult = {
        checkType: 'buying_power',
        passed: false,
        message: 'Insufficient buying power',
      };
      expect(result.details).toBeUndefined();
    });
  });

  describe('OrderValidationResult', () => {
    it('should allow valid OrderValidationResult', () => {
      const result: OrderValidationResult = {
        valid: true,
        checks: [
          { checkType: 'risk_per_trade', passed: true, message: 'OK' },
          { checkType: 'buying_power', passed: true, message: 'OK' },
        ],
        rejectionReasons: [],
        validatedAt: new Date().toISOString(),
      };
      expect(result.valid).toBe(true);
      expect(result.checks.length).toBe(2);
      expect(result.rejectionReasons.length).toBe(0);
    });

    it('should allow OrderValidationResult with failures', () => {
      const result: OrderValidationResult = {
        valid: false,
        checks: [
          { checkType: 'risk_per_trade', passed: false, message: 'Risk too high' },
        ],
        rejectionReasons: ['Risk per trade exceeds limit'],
        validatedAt: new Date().toISOString(),
      };
      expect(result.valid).toBe(false);
      expect(result.rejectionReasons.length).toBe(1);
    });
  });

  describe('DraftOrderInfo', () => {
    it('should allow valid DraftOrderInfo', () => {
      const order: DraftOrderInfo = {
        description: 'BUY 1x AAPL Feb 16 $185 C',
        side: 'buy',
        quantity: 1,
        underlying: 'AAPL',
        strike: 185,
        expiration: '2024-02-16',
        optionType: 'call',
        limitPrice: 3.50,
        estimatedCost: 350,
        idempotencyKey: 'test-uuid-123',
      };
      expect(order.side).toBe('buy');
      expect(order.optionType).toBe('call');
    });

    it('should allow DraftOrderInfo without limitPrice', () => {
      const order: DraftOrderInfo = {
        description: 'SELL 2x SPY Mar 15 $450 P',
        side: 'sell',
        quantity: 2,
        underlying: 'SPY',
        strike: 450,
        expiration: '2024-03-15',
        optionType: 'put',
        estimatedCost: -800,
        idempotencyKey: 'test-uuid-456',
      };
      expect(order.limitPrice).toBeUndefined();
      expect(order.estimatedCost).toBe(-800); // Credit
    });
  });

  describe('TradeProposalInfo', () => {
    it('should allow valid TradeProposalInfo', () => {
      const proposal: TradeProposalInfo = {
        strategyType: 'long_call',
        underlying: 'AAPL',
        thesis: [
          'Bullish on AAPL earnings',
          'Technical breakout pattern forming',
        ],
        catalysts: ['Earnings report on Feb 1'],
        confidence: 'medium',
        risk: {
          maxLoss: 350,
          maxLossPercent: 0.35,
          riskRewardRatio: 2.5,
        },
        exitPlan: {
          profitTargets: [{ percentGain: 50, closePercent: 50 }, { percentGain: 100, closePercent: 50 }],
          stopLoss: { type: 'percent', value: 50 },
          maxHoldDays: 30,
        },
      };
      expect(proposal.strategyType).toBe('long_call');
      expect(proposal.thesis.length).toBe(2);
      expect(proposal.catalysts.length).toBe(1);
    });

    it('should allow TradeProposalInfo without optional fields', () => {
      const proposal: TradeProposalInfo = {
        strategyType: 'vertical_spread',
        underlying: 'TSLA',
        thesis: ['Neutral to slightly bullish'],
        catalysts: [],
        confidence: 'low',
        risk: {
          maxLoss: 200,
        },
      };
      expect(proposal.exitPlan).toBeUndefined();
      expect(proposal.risk.riskRewardRatio).toBeUndefined();
    });
  });

  describe('OrderApprovalData', () => {
    it('should allow valid OrderApprovalData', () => {
      const data: OrderApprovalData = {
        proposalId: 'proposal-123',
        orders: [
          {
            description: 'BUY 1x AAPL Feb 16 $185 C',
            side: 'buy',
            quantity: 1,
            underlying: 'AAPL',
            strike: 185,
            expiration: '2024-02-16',
            optionType: 'call',
            limitPrice: 3.50,
            estimatedCost: 350,
            idempotencyKey: 'uuid-1',
          },
        ],
        totalEstimatedCost: 350,
        validation: {
          valid: true,
          checks: [
            { checkType: 'risk_per_trade', passed: true, message: 'OK' },
          ],
          rejectionReasons: [],
          validatedAt: new Date().toISOString(),
        },
        proposal: {
          strategyType: 'long_call',
          underlying: 'AAPL',
          thesis: ['Bullish thesis'],
          catalysts: [],
          confidence: 'medium',
          risk: { maxLoss: 350 },
        },
        warnings: [],
      };
      expect(data.orders.length).toBe(1);
      expect(data.validation.valid).toBe(true);
    });

    it('should allow OrderApprovalData with warnings and failures', () => {
      const data: OrderApprovalData = {
        orders: [
          {
            description: 'BUY 10x SPY Jan 20 $500 C',
            side: 'buy',
            quantity: 10,
            underlying: 'SPY',
            strike: 500,
            expiration: '2024-01-20',
            optionType: 'call',
            estimatedCost: 15000,
            idempotencyKey: 'uuid-2',
          },
        ],
        totalEstimatedCost: 15000,
        validation: {
          valid: false,
          checks: [
            { checkType: 'risk_per_trade', passed: false, message: 'Risk too high', details: { actual: 15, limit: 2, unit: '%' } },
            { checkType: 'buying_power', passed: false, message: 'Insufficient funds' },
          ],
          rejectionReasons: ['Risk per trade exceeds limit', 'Insufficient buying power'],
          validatedAt: new Date().toISOString(),
        },
        proposal: {
          strategyType: 'long_call',
          underlying: 'SPY',
          thesis: ['Bullish'],
          catalysts: [],
          confidence: 'high',
          risk: { maxLoss: 15000 },
        },
        warnings: ['Large position size', 'Market order type'],
      };
      expect(data.validation.valid).toBe(false);
      expect(data.warnings.length).toBe(2);
      expect(data.validation.rejectionReasons.length).toBe(2);
    });

    it('should allow multi-leg order data', () => {
      const data: OrderApprovalData = {
        orders: [
          {
            description: 'BUY 1x NVDA Feb 16 $600 C',
            side: 'buy',
            quantity: 1,
            underlying: 'NVDA',
            strike: 600,
            expiration: '2024-02-16',
            optionType: 'call',
            limitPrice: 25.00,
            estimatedCost: 2500,
            idempotencyKey: 'uuid-3',
          },
          {
            description: 'SELL 1x NVDA Feb 16 $620 C',
            side: 'sell',
            quantity: 1,
            underlying: 'NVDA',
            strike: 620,
            expiration: '2024-02-16',
            optionType: 'call',
            limitPrice: 15.00,
            estimatedCost: -1500,
            idempotencyKey: 'uuid-4',
          },
        ],
        totalEstimatedCost: 1000, // Net debit
        validation: {
          valid: true,
          checks: [],
          rejectionReasons: [],
          validatedAt: new Date().toISOString(),
        },
        proposal: {
          strategyType: 'vertical_spread',
          underlying: 'NVDA',
          thesis: ['Bullish call debit spread'],
          catalysts: ['Earnings'],
          confidence: 'high',
          risk: { maxLoss: 1000, riskRewardRatio: 1.0 },
        },
        warnings: [],
      };
      expect(data.orders.length).toBe(2);
      expect(data.totalEstimatedCost).toBe(1000);
    });
  });
});
