import { describe, it, expect } from 'vitest';
import {
  calculateSpreadPercent,
  getLiquidityRating,
  getLiquidityDescription,
  computeLiquidityMetrics,
  addLiquidityToContract,
  addLiquidityToChain,
  filterByLiquidity,
  sortByLiquidity,
  getChainLiquiditySummary,
  DEFAULT_LIQUIDITY_CONFIG,
  type LiquidityMetrics,
  type OptionContractWithLiquidity,
} from './liquidity.js';
import type { OptionContract, OptionChain } from '../types/broker.js';

describe('calculateSpreadPercent', () => {
  it('should calculate spread percentage correctly', () => {
    // bid = 1.00, ask = 1.10, mid = 1.05
    // spread = (1.10 - 1.00) / 1.05 * 100 = 9.52%
    const result = calculateSpreadPercent(1.0, 1.1);
    expect(result).toBeCloseTo(9.52, 1);
  });

  it('should return higher spread for wider bid-ask', () => {
    const tightSpread = calculateSpreadPercent(1.0, 1.02);
    const wideSpread = calculateSpreadPercent(1.0, 1.2);
    expect(wideSpread).toBeGreaterThan(tightSpread);
  });

  it('should return Infinity for zero bid', () => {
    expect(calculateSpreadPercent(0, 1.0)).toBe(Infinity);
  });

  it('should return Infinity for zero ask', () => {
    expect(calculateSpreadPercent(1.0, 0)).toBe(Infinity);
  });

  it('should return Infinity for negative prices', () => {
    expect(calculateSpreadPercent(-1.0, 1.0)).toBe(Infinity);
    expect(calculateSpreadPercent(1.0, -1.0)).toBe(Infinity);
  });

  it('should return Infinity when ask < bid', () => {
    expect(calculateSpreadPercent(1.1, 1.0)).toBe(Infinity);
  });

  it('should handle small spreads correctly', () => {
    // Tight spread: bid = 5.00, ask = 5.05
    const result = calculateSpreadPercent(5.0, 5.05);
    expect(result).toBeCloseTo(0.99, 1);
  });
});

describe('getLiquidityRating', () => {
  it('should return "high" for tight spread with good volume/OI', () => {
    const rating = getLiquidityRating(0.5, 1000, 5000);
    expect(rating).toBe('high');
  });

  it('should return "medium" for tight spread with low volume', () => {
    const rating = getLiquidityRating(0.5, 50, 100);
    expect(rating).toBe('medium');
  });

  it('should return "medium" for moderate spread', () => {
    const rating = getLiquidityRating(1.5, 1000, 5000);
    expect(rating).toBe('medium');
  });

  it('should return "low" for wider spread', () => {
    const rating = getLiquidityRating(3.0, 1000, 5000);
    expect(rating).toBe('low');
  });

  it('should return "very_low" for spread > 5%', () => {
    const rating = getLiquidityRating(6.0, 1000, 5000);
    expect(rating).toBe('very_low');
  });

  it('should return "very_low" for Infinity spread', () => {
    const rating = getLiquidityRating(Infinity, 1000, 5000);
    expect(rating).toBe('very_low');
  });

  it('should respect custom config thresholds', () => {
    const strictConfig = {
      ...DEFAULT_LIQUIDITY_CONFIG,
      lowLiquidityThreshold: 2,
      mediumLiquidityThreshold: 1,
      highLiquidityThreshold: 0.5,
    };

    // 1.5% would be "low" with default config, but "very_low" with strict
    const rating = getLiquidityRating(2.5, 1000, 5000, strictConfig);
    expect(rating).toBe('very_low');
  });
});

describe('getLiquidityDescription', () => {
  it('should return description for high liquidity', () => {
    const metrics: LiquidityMetrics = {
      spread: 0.05,
      spreadPercent: 0.5,
      midPrice: 5.0,
      volume: 1000,
      openInterest: 5000,
      rating: 'high',
      lowLiquidityWarning: false,
      description: '',
    };
    const desc = getLiquidityDescription(metrics);
    expect(desc).toContain('Excellent liquidity');
    expect(desc).toContain('0.50%');
    expect(desc).toContain('1,000');
    expect(desc).toContain('5,000');
  });

  it('should return description for very_low liquidity', () => {
    const metrics: LiquidityMetrics = {
      spread: 1.0,
      spreadPercent: 10.0,
      midPrice: 5.0,
      volume: 10,
      openInterest: 50,
      rating: 'very_low',
      lowLiquidityWarning: true,
      description: '',
    };
    const desc = getLiquidityDescription(metrics);
    expect(desc).toContain('Poor liquidity');
  });

  it('should handle Infinity spread', () => {
    const metrics: LiquidityMetrics = {
      spread: 0,
      spreadPercent: Infinity,
      midPrice: 0,
      volume: 0,
      openInterest: 0,
      rating: 'very_low',
      lowLiquidityWarning: true,
      description: '',
    };
    const desc = getLiquidityDescription(metrics);
    expect(desc).toContain('No valid quotes');
  });
});

describe('computeLiquidityMetrics', () => {
  it('should compute metrics for option contract', () => {
    const contract: OptionContract = {
      optionSymbol: 'AAPL240216C00185000',
      underlying: 'AAPL',
      strike: 185,
      expiration: new Date('2024-02-16'),
      optionType: 'call',
      bid: 4.90,
      ask: 5.10,
      mid: 5.0,
      last: 5.0,
      volume: 500,
      openInterest: 2000,
      multiplier: 100,
    };

    const metrics = computeLiquidityMetrics(contract);

    expect(metrics.spread).toBeCloseTo(0.2);
    expect(metrics.midPrice).toBeCloseTo(5.0);
    expect(metrics.spreadPercent).toBeCloseTo(4.0, 1);
    expect(metrics.volume).toBe(500);
    expect(metrics.openInterest).toBe(2000);
    expect(metrics.lowLiquidityWarning).toBe(false);
    expect(metrics.rating).toBe('low');
  });

  it('should flag low liquidity warning for spread > 5%', () => {
    const contract: OptionContract = {
      optionSymbol: 'AAPL240216C00250000',
      underlying: 'AAPL',
      strike: 250,
      expiration: new Date('2024-02-16'),
      optionType: 'call',
      bid: 0.10,
      ask: 0.20,
      mid: 0.15,
      last: 0.15,
      volume: 5,
      openInterest: 20,
      multiplier: 100,
    };

    const metrics = computeLiquidityMetrics(contract);

    // spread = (0.20 - 0.10) / 0.15 * 100 = 66.67%
    expect(metrics.spreadPercent).toBeGreaterThan(5);
    expect(metrics.lowLiquidityWarning).toBe(true);
    expect(metrics.rating).toBe('very_low');
  });

  it('should handle quote without openInterest', () => {
    const quote = {
      symbol: 'AAPL',
      bid: 180.0,
      ask: 180.50,
      mid: 180.25,
      last: 180.30,
      bidSize: 100,
      askSize: 100,
      volume: 50000000,
      asOf: new Date(),
    };

    const metrics = computeLiquidityMetrics(quote);

    expect(metrics.volume).toBe(50000000);
    expect(metrics.openInterest).toBe(0);
  });
});

describe('addLiquidityToContract', () => {
  it('should add liquidity metrics to contract', () => {
    const contract: OptionContract = {
      optionSymbol: 'SPY240315P00475000',
      underlying: 'SPY',
      strike: 475,
      expiration: new Date('2024-03-15'),
      optionType: 'put',
      bid: 3.40,
      ask: 3.50,
      mid: 3.45,
      last: 3.45,
      volume: 2000,
      openInterest: 10000,
      multiplier: 100,
    };

    const result = addLiquidityToContract(contract);

    expect(result.liquidity).toBeDefined();
    expect(result.liquidity.spreadPercent).toBeCloseTo(2.9, 1);
    expect(result.optionSymbol).toBe(contract.optionSymbol);
    expect(result.strike).toBe(contract.strike);
  });
});

describe('addLiquidityToChain', () => {
  const createMockChain = (): OptionChain => ({
    underlying: 'AAPL',
    underlyingPrice: 185.0,
    expirations: [new Date('2024-02-16'), new Date('2024-03-15')],
    contracts: new Map([
      [
        '2024-02-16T00:00:00.000Z',
        [
          {
            optionSymbol: 'AAPL240216C00180000',
            underlying: 'AAPL',
            strike: 180,
            expiration: new Date('2024-02-16'),
            optionType: 'call',
            bid: 6.0,
            ask: 6.20,
            mid: 6.10,
            last: 6.10,
            volume: 1000,
            openInterest: 5000,
            multiplier: 100,
          },
          {
            optionSymbol: 'AAPL240216C00190000',
            underlying: 'AAPL',
            strike: 190,
            expiration: new Date('2024-02-16'),
            optionType: 'call',
            bid: 0.50,
            ask: 1.00,
            mid: 0.75,
            last: 0.75,
            volume: 10,
            openInterest: 50,
            multiplier: 100,
          },
        ],
      ],
    ]),
    asOf: new Date(),
  });

  it('should add liquidity to all contracts in chain', () => {
    const chain = createMockChain();
    const result = addLiquidityToChain(chain);

    for (const [, contracts] of result.contracts) {
      for (const contract of contracts) {
        expect(contract.liquidity).toBeDefined();
        expect(typeof contract.liquidity.spreadPercent).toBe('number');
        expect(typeof contract.liquidity.rating).toBe('string');
      }
    }
  });

  it('should preserve chain metadata', () => {
    const chain = createMockChain();
    const result = addLiquidityToChain(chain);

    expect(result.underlying).toBe(chain.underlying);
    expect(result.underlyingPrice).toBe(chain.underlyingPrice);
    expect(result.expirations).toEqual(chain.expirations);
  });
});

describe('filterByLiquidity', () => {
  const createContractsWithLiquidity = (): OptionContractWithLiquidity[] => [
    {
      optionSymbol: 'HIGH',
      underlying: 'TEST',
      strike: 100,
      expiration: new Date(),
      optionType: 'call',
      bid: 5.0,
      ask: 5.05,
      mid: 5.025,
      last: 5.0,
      volume: 1000,
      openInterest: 5000,
      multiplier: 100,
      liquidity: {
        spread: 0.05,
        spreadPercent: 1.0,
        midPrice: 5.025,
        volume: 1000,
        openInterest: 5000,
        rating: 'high',
        lowLiquidityWarning: false,
        description: 'High liquidity',
      },
    },
    {
      optionSymbol: 'MEDIUM',
      underlying: 'TEST',
      strike: 105,
      expiration: new Date(),
      optionType: 'call',
      bid: 3.0,
      ask: 3.10,
      mid: 3.05,
      last: 3.05,
      volume: 50,
      openInterest: 200,
      multiplier: 100,
      liquidity: {
        spread: 0.10,
        spreadPercent: 3.3,
        midPrice: 3.05,
        volume: 50,
        openInterest: 200,
        rating: 'medium',
        lowLiquidityWarning: false,
        description: 'Medium liquidity',
      },
    },
    {
      optionSymbol: 'VERY_LOW',
      underlying: 'TEST',
      strike: 120,
      expiration: new Date(),
      optionType: 'call',
      bid: 0.10,
      ask: 0.30,
      mid: 0.20,
      last: 0.20,
      volume: 5,
      openInterest: 10,
      multiplier: 100,
      liquidity: {
        spread: 0.20,
        spreadPercent: 100,
        midPrice: 0.20,
        volume: 5,
        openInterest: 10,
        rating: 'very_low',
        lowLiquidityWarning: true,
        description: 'Very low liquidity',
      },
    },
  ];

  it('should filter to minimum rating', () => {
    const contracts = createContractsWithLiquidity();

    const highOnly = filterByLiquidity(contracts, 'high');
    expect(highOnly.length).toBe(1);
    expect(highOnly[0].optionSymbol).toBe('HIGH');

    const mediumPlus = filterByLiquidity(contracts, 'medium');
    expect(mediumPlus.length).toBe(2);

    const allContracts = filterByLiquidity(contracts, 'very_low');
    expect(allContracts.length).toBe(3);
  });

  it('should return empty array when no contracts meet criteria', () => {
    const contracts = createContractsWithLiquidity().filter(
      (c) => c.liquidity.rating === 'very_low'
    );
    const result = filterByLiquidity(contracts, 'high');
    expect(result.length).toBe(0);
  });
});

describe('sortByLiquidity', () => {
  it('should sort by rating then spread', () => {
    const contracts: OptionContractWithLiquidity[] = [
      {
        optionSymbol: 'LOW_3',
        underlying: 'TEST',
        strike: 100,
        expiration: new Date(),
        optionType: 'call',
        bid: 1,
        ask: 1.1,
        mid: 1.05,
        last: 1.05,
        volume: 100,
        openInterest: 500,
        multiplier: 100,
        liquidity: {
          spread: 0.1,
          spreadPercent: 3.0,
          midPrice: 1.05,
          volume: 100,
          openInterest: 500,
          rating: 'low',
          lowLiquidityWarning: false,
          description: '',
        },
      },
      {
        optionSymbol: 'HIGH_0.5',
        underlying: 'TEST',
        strike: 105,
        expiration: new Date(),
        optionType: 'call',
        bid: 2,
        ask: 2.01,
        mid: 2.005,
        last: 2.0,
        volume: 1000,
        openInterest: 5000,
        multiplier: 100,
        liquidity: {
          spread: 0.01,
          spreadPercent: 0.5,
          midPrice: 2.005,
          volume: 1000,
          openInterest: 5000,
          rating: 'high',
          lowLiquidityWarning: false,
          description: '',
        },
      },
      {
        optionSymbol: 'HIGH_0.8',
        underlying: 'TEST',
        strike: 110,
        expiration: new Date(),
        optionType: 'call',
        bid: 1.5,
        ask: 1.512,
        mid: 1.506,
        last: 1.5,
        volume: 1000,
        openInterest: 5000,
        multiplier: 100,
        liquidity: {
          spread: 0.012,
          spreadPercent: 0.8,
          midPrice: 1.506,
          volume: 1000,
          openInterest: 5000,
          rating: 'high',
          lowLiquidityWarning: false,
          description: '',
        },
      },
    ];

    const sorted = sortByLiquidity(contracts);

    // High rating contracts first, then sorted by spread within rating
    expect(sorted[0].optionSymbol).toBe('HIGH_0.5');
    expect(sorted[1].optionSymbol).toBe('HIGH_0.8');
    expect(sorted[2].optionSymbol).toBe('LOW_3');
  });

  it('should not mutate original array', () => {
    const contracts: OptionContractWithLiquidity[] = [
      {
        optionSymbol: 'B',
        underlying: 'TEST',
        strike: 100,
        expiration: new Date(),
        optionType: 'call',
        bid: 1,
        ask: 1.1,
        mid: 1.05,
        last: 1.05,
        volume: 10,
        openInterest: 50,
        multiplier: 100,
        liquidity: {
          spread: 0.1,
          spreadPercent: 5.0,
          midPrice: 1.05,
          volume: 10,
          openInterest: 50,
          rating: 'very_low',
          lowLiquidityWarning: true,
          description: '',
        },
      },
      {
        optionSymbol: 'A',
        underlying: 'TEST',
        strike: 100,
        expiration: new Date(),
        optionType: 'call',
        bid: 2,
        ask: 2.02,
        mid: 2.01,
        last: 2.0,
        volume: 1000,
        openInterest: 5000,
        multiplier: 100,
        liquidity: {
          spread: 0.02,
          spreadPercent: 1.0,
          midPrice: 2.01,
          volume: 1000,
          openInterest: 5000,
          rating: 'high',
          lowLiquidityWarning: false,
          description: '',
        },
      },
    ];

    const originalFirst = contracts[0].optionSymbol;
    sortByLiquidity(contracts);
    expect(contracts[0].optionSymbol).toBe(originalFirst);
  });
});

describe('getChainLiquiditySummary', () => {
  it('should compute summary statistics', () => {
    const chain = {
      underlying: 'TEST',
      underlyingPrice: 100,
      expirations: [new Date()],
      contracts: new Map([
        [
          '2024-01-01',
          [
            {
              optionSymbol: 'A',
              underlying: 'TEST',
              strike: 95,
              expiration: new Date(),
              optionType: 'call' as const,
              bid: 5,
              ask: 5.05,
              mid: 5.025,
              last: 5,
              volume: 1000,
              openInterest: 5000,
              multiplier: 100,
              liquidity: {
                spread: 0.05,
                spreadPercent: 1.0,
                midPrice: 5.025,
                volume: 1000,
                openInterest: 5000,
                rating: 'high' as const,
                lowLiquidityWarning: false,
                description: '',
              },
            },
            {
              optionSymbol: 'B',
              underlying: 'TEST',
              strike: 100,
              expiration: new Date(),
              optionType: 'call' as const,
              bid: 2,
              ask: 2.06,
              mid: 2.03,
              last: 2,
              volume: 500,
              openInterest: 2000,
              multiplier: 100,
              liquidity: {
                spread: 0.06,
                spreadPercent: 3.0,
                midPrice: 2.03,
                volume: 500,
                openInterest: 2000,
                rating: 'low' as const,
                lowLiquidityWarning: false,
                description: '',
              },
            },
            {
              optionSymbol: 'C',
              underlying: 'TEST',
              strike: 120,
              expiration: new Date(),
              optionType: 'call' as const,
              bid: 0.1,
              ask: 0.2,
              mid: 0.15,
              last: 0.15,
              volume: 5,
              openInterest: 10,
              multiplier: 100,
              liquidity: {
                spread: 0.1,
                spreadPercent: 66.67,
                midPrice: 0.15,
                volume: 5,
                openInterest: 10,
                rating: 'very_low' as const,
                lowLiquidityWarning: true,
                description: '',
              },
            },
          ],
        ],
      ]),
      asOf: new Date(),
    };

    const summary = getChainLiquiditySummary(chain);

    expect(summary.totalContracts).toBe(3);
    expect(summary.highLiquidity).toBe(1);
    expect(summary.lowLiquidity).toBe(1);
    expect(summary.veryLowLiquidity).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.averageSpreadPercent).toBeCloseTo((1.0 + 3.0 + 66.67) / 3, 1);
  });

  it('should handle empty chain', () => {
    const chain = {
      underlying: 'TEST',
      underlyingPrice: 100,
      expirations: [],
      contracts: new Map(),
      asOf: new Date(),
    };

    const summary = getChainLiquiditySummary(chain);

    expect(summary.totalContracts).toBe(0);
    expect(summary.highLiquidity).toBe(0);
    expect(summary.averageSpreadPercent).toBe(0);
  });
});

describe('DEFAULT_LIQUIDITY_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_LIQUIDITY_CONFIG.lowLiquidityThreshold).toBe(5);
    expect(DEFAULT_LIQUIDITY_CONFIG.mediumLiquidityThreshold).toBe(2);
    expect(DEFAULT_LIQUIDITY_CONFIG.highLiquidityThreshold).toBe(1);
    expect(DEFAULT_LIQUIDITY_CONFIG.minVolumeForGoodLiquidity).toBe(100);
    expect(DEFAULT_LIQUIDITY_CONFIG.minOpenInterestForGoodLiquidity).toBe(500);
  });
});
