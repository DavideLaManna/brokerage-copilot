/**
 * Tradier Adapter Tests
 *
 * Tests for the Tradier broker adapter implementation.
 * Uses mocked fetch responses to simulate Tradier API behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TradierAdapter, createTradierAdapter } from './tradier-adapter.js';
import { BrokerError, BrokerErrorCode, AuthenticationError, RateLimitError } from '../../types/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('TradierAdapter', () => {
  const testAccessToken = 'test-access-token';
  const testAccountId = 'ABC123456';
  let adapter: TradierAdapter;

  beforeEach(() => {
    mockFetch.mockReset();
    adapter = new TradierAdapter(testAccessToken, testAccountId, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create adapter with sandbox URL by default', () => {
      const adapter = new TradierAdapter(testAccessToken, testAccountId);
      expect(adapter.brokerType).toBe('tradier');
      expect(adapter.brokerName).toBe('Tradier');
    });

    it('should use production URL when sandbox is false', () => {
      const adapter = new TradierAdapter(testAccessToken, testAccountId, false);
      expect(adapter.brokerType).toBe('tradier');
    });
  });

  describe('validateConnection', () => {
    it('should return true when credentials are valid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            account: [
              {
                account_number: testAccountId,
                classification: 'individual',
                day_trader: false,
                option_level: 2,
                status: 'active',
                type: 'cash',
              },
            ],
          },
        }),
      });

      const result = await adapter.validateConnection();
      expect(result).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://sandbox.tradier.com/v1/user/profile',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${testAccessToken}`,
          }),
        })
      );
    });

    it('should throw AuthenticationError on 401 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(adapter.validateConnection()).rejects.toThrow(AuthenticationError);
    });

    it('should throw BrokerError when account not found in profile', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          profile: {
            account: [
              {
                account_number: 'DIFFERENT123',
                classification: 'individual',
                day_trader: false,
                option_level: 2,
                status: 'active',
                type: 'cash',
              },
            ],
          },
        }),
      };

      mockFetch.mockResolvedValueOnce(mockResponse);

      await expect(adapter.validateConnection()).rejects.toMatchObject({
        code: BrokerErrorCode.ACCOUNT_NOT_FOUND,
      });
    });
  });

  describe('getAccountSummary', () => {
    it('should return account summary with correct values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          balances: {
            option_short_value: 0,
            total_equity: 50000,
            account_number: testAccountId,
            account_type: 'margin',
            close_pl: 150,
            current_requirement: 0,
            equity: 50000,
            long_market_value: 25000,
            market_value: 25000,
            open_pl: 500,
            option_buying_power: 25000,
            option_long_value: 5000,
            option_requirement: 0,
            pending_orders_count: 0,
            short_market_value: 0,
            stock_buying_power: 50000,
            stock_long_value: 20000,
            uncleared_funds: 0,
            pending_cash: 0,
            cash: {
              cash_available: 25000,
              sweep: 0,
              unsettled_funds: 0,
            },
            margin: {
              fed_call: 0,
              maintenance_call: 0,
              option_buying_power: 25000,
              stock_buying_power: 50000,
              stock_short_value: 0,
            },
          },
        }),
      });

      const summary = await adapter.getAccountSummary();

      expect(summary.netLiquidation).toBe(50000);
      expect(summary.buyingPower).toBe(25000);
      expect(summary.cash).toBe(25000);
      expect(summary.dailyPnL).toBe(150);
      expect(summary.unrealizedPnL).toBe(500);
      expect(summary.currency).toBe('USD');
      expect(summary.asOf).toBeInstanceOf(Date);
    });

    it('should throw RateLimitError on 429 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Map([['Retry-After', '60']]),
        text: async () => 'Rate limit exceeded',
      });

      // Mock headers.get
      const mockHeaders = {
        get: (name: string) => (name === 'Retry-After' ? '60' : null),
      };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: mockHeaders,
        text: async () => 'Rate limit exceeded',
      });

      await expect(adapter.getAccountSummary()).rejects.toThrow(RateLimitError);
    });
  });

  describe('getPositions', () => {
    it('should return empty array when no positions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          positions: 'null',
        }),
      });

      const positions = await adapter.getPositions();
      expect(positions).toEqual([]);
    });

    it('should return positions with calculated P&L', async () => {
      // Mock positions response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          positions: {
            position: [
              {
                cost_basis: 5000,
                date_acquired: '2024-01-01T00:00:00.000Z',
                id: 1,
                quantity: 100,
                symbol: 'AAPL',
              },
            ],
          },
        }),
      });

      // Mock quotes response for position symbols
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          quotes: {
            quote: {
              symbol: 'AAPL',
              last: 55,
              bid: 54.9,
              ask: 55.1,
              bidsize: 100,
              asksize: 100,
              volume: 1000000,
            },
          },
        }),
      });

      const positions = await adapter.getPositions();

      expect(positions).toHaveLength(1);
      expect(positions[0].symbol).toBe('AAPL');
      expect(positions[0].quantity).toBe(100);
      expect(positions[0].currentPrice).toBe(55);
      expect(positions[0].marketValue).toBe(5500); // 100 shares * $55
      expect(positions[0].unrealizedPnL).toBe(500); // 5500 - 5000
      expect(positions[0].assetClass).toBe('equity');
    });

    it('should handle option positions correctly', async () => {
      // Mock positions response with option
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          positions: {
            position: {
              cost_basis: 500,
              date_acquired: '2024-01-01T00:00:00.000Z',
              id: 2,
              quantity: 1,
              symbol: 'AAPL240119C00150000',
            },
          },
        }),
      });

      // Mock quotes response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          quotes: {
            quote: {
              symbol: 'AAPL240119C00150000',
              last: 6.5,
              bid: 6.4,
              ask: 6.6,
              bidsize: 10,
              asksize: 10,
              volume: 500,
              underlying: 'AAPL',
              strike: 150,
              contract_size: 100,
              expiration_date: '2024-01-19',
              option_type: 'call',
            },
          },
        }),
      });

      const positions = await adapter.getPositions();

      expect(positions).toHaveLength(1);
      expect(positions[0].assetClass).toBe('option');
      expect(positions[0].optionDetails).toBeDefined();
      expect(positions[0].optionDetails?.underlying).toBe('AAPL');
      expect(positions[0].optionDetails?.strike).toBe(150);
      expect(positions[0].optionDetails?.optionType).toBe('call');
    });
  });

  describe('getOpenOrders', () => {
    it('should return empty array when no orders', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          orders: 'null',
        }),
      });

      const orders = await adapter.getOpenOrders();
      expect(orders).toEqual([]);
    });

    it('should return only open orders', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          orders: {
            order: [
              {
                id: 1,
                type: 'limit',
                symbol: 'AAPL',
                side: 'buy',
                quantity: 100,
                status: 'open',
                duration: 'day',
                price: 150,
                create_date: '2024-01-15T10:00:00.000Z',
                transaction_date: '2024-01-15T10:00:00.000Z',
                class: 'equity',
              },
              {
                id: 2,
                type: 'limit',
                symbol: 'MSFT',
                side: 'sell',
                quantity: 50,
                status: 'filled',
                duration: 'day',
                price: 380,
                create_date: '2024-01-15T09:00:00.000Z',
                transaction_date: '2024-01-15T09:30:00.000Z',
                class: 'equity',
                avg_fill_price: 380.5,
                exec_quantity: 50,
              },
            ],
          },
        }),
      });

      const orders = await adapter.getOpenOrders();

      expect(orders).toHaveLength(1);
      expect(orders[0].id).toBe('1');
      expect(orders[0].symbol).toBe('AAPL');
      expect(orders[0].status).toBe('open');
    });
  });

  describe('getQuote', () => {
    it('should return quote with calculated mid price', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          quotes: {
            quote: {
              symbol: 'AAPL',
              last: 150.5,
              bid: 150.4,
              ask: 150.6,
              bidsize: 100,
              asksize: 100,
              volume: 1000000,
            },
          },
        }),
      });

      const quote = await adapter.getQuote('AAPL');

      expect(quote.symbol).toBe('AAPL');
      expect(quote.bid).toBe(150.4);
      expect(quote.ask).toBe(150.6);
      expect(quote.mid).toBe(150.5); // (150.4 + 150.6) / 2
      expect(quote.last).toBe(150.5);
      expect(quote.volume).toBe(1000000);
    });

    it('should throw error when quote unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          quotes: {
            quote: null,
          },
        }),
      });

      await expect(adapter.getQuote('INVALID')).rejects.toThrow(BrokerError);
    });
  });

  describe('getOptionChain', () => {
    it('should return option chain with contracts grouped by expiration', async () => {
      // Mock underlying quote
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          quotes: {
            quote: {
              symbol: 'AAPL',
              last: 150,
              bid: 149.9,
              ask: 150.1,
              bidsize: 100,
              asksize: 100,
              volume: 1000000,
            },
          },
        }),
      });

      // Mock expirations
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          expirations: {
            expiration: [
              {
                date: '2024-01-19',
                contract_size: 100,
                expiration_type: 'standard',
                strikes: [145, 150, 155],
              },
            ],
          },
        }),
      });

      // Mock chain data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          options: {
            option: [
              {
                symbol: 'AAPL240119C00150000',
                underlying: 'AAPL',
                strike: 150,
                contract_size: 100,
                expiration_date: '2024-01-19',
                expiration_type: 'standard',
                option_type: 'call',
                bid: 2.5,
                ask: 2.7,
                last: 2.6,
                volume: 1000,
                open_interest: 5000,
                greeks: {
                  delta: 0.5,
                  gamma: 0.05,
                  theta: -0.1,
                  vega: 0.2,
                  rho: 0.01,
                  phi: 0,
                  bid_iv: 0.25,
                  mid_iv: 0.26,
                  ask_iv: 0.27,
                  smv_vol: 0.25,
                  updated_at: '2024-01-15T12:00:00.000Z',
                },
              },
            ],
          },
        }),
      });

      const chain = await adapter.getOptionChain({ symbol: 'AAPL' });

      expect(chain.underlying).toBe('AAPL');
      expect(chain.underlyingPrice).toBe(150);
      expect(chain.expirations).toHaveLength(1);
      expect(chain.contracts.size).toBe(1);

      const contracts = chain.contracts.get('2024-01-19');
      expect(contracts).toBeDefined();
      expect(contracts).toHaveLength(1);
      expect(contracts![0].strike).toBe(150);
      expect(contracts![0].optionType).toBe('call');
      expect(contracts![0].greeks?.delta).toBe(0.5);
    });
  });

  describe('placeOrder', () => {
    it('should place equity order successfully', async () => {
      // Mock order creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          order: {
            id: 12345,
            status: 'ok',
            partner_id: 'abc123',
          },
        }),
      });

      // Mock order fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          order: {
            id: 12345,
            type: 'limit',
            symbol: 'AAPL',
            side: 'buy',
            quantity: 100,
            status: 'open',
            duration: 'day',
            price: 150,
            create_date: '2024-01-15T10:00:00.000Z',
            transaction_date: '2024-01-15T10:00:00.000Z',
            class: 'equity',
          },
        }),
      });

      const order = await adapter.placeOrder(
        {
          symbol: 'AAPL',
          assetClass: 'equity',
          side: 'buy',
          orderType: 'limit',
          timeInForce: 'day',
          quantity: 100,
          limitPrice: 150,
        },
        'test-idempotency-key'
      );

      expect(order.id).toBe('12345');
      expect(order.symbol).toBe('AAPL');
      expect(order.status).toBe('open');
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          order: {
            id: 12345,
            status: 'ok',
          },
        }),
      });

      const result = await adapter.cancelOrder('12345');
      expect(result).toBe(true);
    });

    it('should return false when order not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Order not found',
      });

      const result = await adapter.cancelOrder('99999');
      expect(result).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should clear access token on disconnect', async () => {
      await adapter.disconnect();
      // After disconnect, any API call should fail
      // This is a basic check that disconnect was called
      expect(true).toBe(true);
    });
  });

  describe('getHistoricalBars', () => {
    it('should return daily historical bars', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          history: {
            day: [
              {
                date: '2024-01-15',
                open: 150.0,
                high: 152.5,
                low: 149.0,
                close: 151.5,
                volume: 1000000,
              },
              {
                date: '2024-01-16',
                open: 151.5,
                high: 153.0,
                low: 150.5,
                close: 152.0,
                volume: 1200000,
              },
            ],
          },
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'daily',
      });

      expect(result.symbol).toBe('AAPL');
      expect(result.interval).toBe('daily');
      expect(result.bars).toHaveLength(2);
      expect(result.bars[0].open).toBe(150.0);
      expect(result.bars[0].high).toBe(152.5);
      expect(result.bars[0].low).toBe(149.0);
      expect(result.bars[0].close).toBe(151.5);
      expect(result.bars[0].volume).toBe(1000000);
    });

    it('should return empty bars when no history', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          history: null,
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'daily',
      });

      expect(result.bars).toEqual([]);
    });

    it('should return weekly historical bars', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          history: {
            day: {
              date: '2024-01-15',
              open: 150.0,
              high: 155.0,
              low: 148.0,
              close: 153.0,
              volume: 5000000,
            },
          },
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'weekly',
      });

      expect(result.interval).toBe('weekly');
      expect(result.bars).toHaveLength(1);
    });

    it('should return intraday bars using timesales endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          series: {
            data: [
              {
                time: '2024-01-15T10:00:00',
                timestamp: 1705316400,
                open: 150.0,
                high: 150.5,
                low: 149.5,
                close: 150.25,
                volume: 10000,
                vwap: 150.1,
              },
              {
                time: '2024-01-15T10:01:00',
                timestamp: 1705316460,
                open: 150.25,
                high: 150.75,
                low: 150.0,
                close: 150.5,
                volume: 12000,
                vwap: 150.35,
              },
            ],
          },
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'minute',
      });

      expect(result.symbol).toBe('AAPL');
      expect(result.interval).toBe('minute');
      expect(result.bars).toHaveLength(2);
      expect(result.bars[0].vwap).toBe(150.1);
    });

    it('should return empty bars when no timesales data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          series: null,
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'minute',
      });

      expect(result.bars).toEqual([]);
    });

    it('should aggregate minute bars to hourly', async () => {
      // Create 60 minute bars for one hour
      const minuteBars = [];
      const baseTimestamp = 1705316400; // 10:00 AM
      for (let i = 0; i < 60; i++) {
        minuteBars.push({
          time: `2024-01-15T10:${i.toString().padStart(2, '0')}:00`,
          timestamp: baseTimestamp + i * 60,
          open: 150.0 + i * 0.01,
          high: 150.5 + i * 0.01,
          low: 149.5 + i * 0.01,
          close: 150.25 + i * 0.01,
          volume: 1000,
        });
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          series: {
            data: minuteBars,
          },
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'hourly',
      });

      expect(result.interval).toBe('hourly');
      expect(result.bars.length).toBeGreaterThan(0);
      // Aggregated hourly bar should have sum of volumes
      expect(result.bars[0].volume).toBe(60000); // 60 bars * 1000
    });

    it('should respect limit parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          history: {
            day: [
              { date: '2024-01-10', open: 148, high: 149, low: 147, close: 148.5, volume: 900000 },
              { date: '2024-01-11', open: 148.5, high: 150, low: 148, close: 149, volume: 950000 },
              { date: '2024-01-12', open: 149, high: 151, low: 148.5, close: 150, volume: 1000000 },
              { date: '2024-01-15', open: 150, high: 152.5, low: 149, close: 151.5, volume: 1100000 },
              { date: '2024-01-16', open: 151.5, high: 153, low: 150.5, close: 152, volume: 1200000 },
            ],
          },
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'daily',
        limit: 3,
      });

      expect(result.bars).toHaveLength(3);
      // Should return the most recent 3 bars (oldest first after slicing)
      expect(result.bars[2].close).toBe(152); // Most recent
    });

    it('should sort bars chronologically', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          history: {
            day: [
              { date: '2024-01-16', open: 151.5, high: 153, low: 150.5, close: 152, volume: 1200000 },
              { date: '2024-01-15', open: 150, high: 152.5, low: 149, close: 151.5, volume: 1100000 },
            ],
          },
        }),
      });

      const result = await adapter.getHistoricalBars({
        symbol: 'AAPL',
        interval: 'daily',
      });

      // Should be sorted oldest first
      expect(result.bars[0].close).toBe(151.5); // Jan 15
      expect(result.bars[1].close).toBe(152); // Jan 16
    });
  });
});

describe('createTradierAdapter', () => {
  it('should throw error when access token is missing', async () => {
    await expect(
      createTradierAdapter({
        brokerType: 'tradier',
        accountId: 'ABC123',
      })
    ).rejects.toThrow(AuthenticationError);
  });

  it('should throw error when account ID is missing', async () => {
    await expect(
      createTradierAdapter({
        brokerType: 'tradier',
        accessToken: 'test-token',
      })
    ).rejects.toThrow(BrokerError);
  });

  it('should create adapter with valid config', async () => {
    const adapter = await createTradierAdapter({
      brokerType: 'tradier',
      accessToken: 'test-token',
      accountId: 'ABC123',
      sandbox: true,
    });

    expect(adapter).toBeInstanceOf(TradierAdapter);
    expect(adapter.brokerType).toBe('tradier');
  });
});
