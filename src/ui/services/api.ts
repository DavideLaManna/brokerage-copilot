/**
 * API Client for Options Trading Copilot
 *
 * Handles communication with the backend API server.
 */

import type {
  AccountSummary,
  Position,
  Order,
  ConnectionState,
  OptionChain,
  OptionContract,
  PortfolioExposure,
  UnderlyingExposure,
  PortfolioGreeks,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * API response wrapper
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

/**
 * Portfolio data from the API
 */
interface PortfolioData {
  account: AccountSummary | null;
  positions: Position[];
  orders: Order[];
  connected: boolean;
  brokerType: string | null;
}

/**
 * Connection info from the API
 */
interface ConnectionInfo {
  connected: boolean;
  brokerName: string | null;
  accountId: string | null;
  lastUpdated: string | null;
}

/**
 * API error class
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const json = (await response.json()) as ApiResponse<T>;

  if (!json.success) {
    throw new ApiError(json.error || 'Unknown error', response.status);
  }

  return json.data as T;
}

/**
 * Parse date strings in API responses
 */
function parseDates<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result) as (keyof T)[]) {
    const value = result[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      (result[key] as unknown) = new Date(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      (result[key] as unknown) = parseDates(value as Record<string, unknown>);
    }
  }
  return result;
}

/**
 * Parse positions from API response
 */
function parsePositions(positions: Position[]): Position[] {
  return positions.map((p) => ({
    ...p,
    optionDetails: p.optionDetails
      ? {
          ...p.optionDetails,
          expiration: new Date(p.optionDetails.expiration),
        }
      : undefined,
  }));
}

/**
 * Parse orders from API response
 */
function parseOrders(orders: Order[]): Order[] {
  return orders.map((o) => ({
    ...o,
    submittedAt: new Date(o.submittedAt),
    filledAt: o.filledAt ? new Date(o.filledAt) : undefined,
    optionDetails: o.optionDetails
      ? {
          ...o.optionDetails,
          expiration: new Date(o.optionDetails.expiration),
        }
      : undefined,
  }));
}

/**
 * API Client
 */
/**
 * Parse option contracts from API response
 */
function parseOptionContracts(contracts: Record<string, OptionContract[]>): Record<string, OptionContract[]> {
  const result: Record<string, OptionContract[]> = {};
  for (const [expiration, contractList] of Object.entries(contracts)) {
    result[expiration] = contractList.map((c) => ({
      ...c,
      expiration: new Date(c.expiration),
    }));
  }
  return result;
}

export const api = {
  /**
   * Check API health
   */
  async health(): Promise<{ status: string }> {
    return fetchApi<{ status: string }>('/api/health');
  },

  /**
   * Get connection status
   */
  async getConnection(): Promise<ConnectionState> {
    const info = await fetchApi<ConnectionInfo>('/api/connection');
    return {
      connected: info.connected,
      brokerName: info.brokerName || 'Unknown',
      accountId: info.accountId ?? undefined,
      lastUpdated: info.lastUpdated ? new Date(info.lastUpdated) : undefined,
    };
  },

  /**
   * Connect to broker
   */
  async connect(brokerType?: string): Promise<{ connected: boolean; accountSummary?: AccountSummary }> {
    const result = await fetchApi<{ connected: boolean; accountSummary?: AccountSummary }>(
      '/api/connect',
      {
        method: 'POST',
        body: JSON.stringify({ brokerType }),
      }
    );
    if (result.accountSummary) {
      result.accountSummary = parseDates(result.accountSummary);
    }
    return result;
  },

  /**
   * Disconnect from broker
   */
  async disconnect(): Promise<void> {
    await fetchApi<{ disconnected: boolean }>('/api/disconnect', {
      method: 'POST',
    });
  },

  /**
   * Get account summary
   */
  async getAccount(): Promise<AccountSummary> {
    const account = await fetchApi<AccountSummary>('/api/account');
    return {
      ...account,
      asOf: new Date(account.asOf),
    };
  },

  /**
   * Get open positions
   */
  async getPositions(): Promise<Position[]> {
    const positions = await fetchApi<Position[]>('/api/positions');
    return parsePositions(positions);
  },

  /**
   * Get open orders
   */
  async getOrders(): Promise<Order[]> {
    const orders = await fetchApi<Order[]>('/api/orders');
    return parseOrders(orders);
  },

  /**
   * Get full portfolio data
   */
  async getPortfolio(): Promise<{
    account: AccountSummary | null;
    positions: Position[];
    orders: Order[];
    connected: boolean;
  }> {
    const data = await fetchApi<PortfolioData>('/api/portfolio');
    return {
      account: data.account
        ? {
            ...data.account,
            asOf: new Date(data.account.asOf),
          }
        : null,
      positions: parsePositions(data.positions),
      orders: parseOrders(data.orders),
      connected: data.connected,
    };
  },

  /**
   * Refresh all portfolio data
   */
  async refresh(): Promise<{
    account: AccountSummary | null;
    positions: Position[];
    orders: Order[];
    connected: boolean;
  }> {
    const data = await fetchApi<PortfolioData>('/api/refresh', {
      method: 'POST',
    });
    return {
      account: data.account
        ? {
            ...data.account,
            asOf: new Date(data.account.asOf),
          }
        : null,
      positions: parsePositions(data.positions),
      orders: parseOrders(data.orders),
      connected: data.connected,
    };
  },

  /**
   * Get option chain with liquidity scores
   */
  async getOptionChain(
    symbol: string,
    options?: { minDTE?: number; maxDTE?: number }
  ): Promise<OptionChain> {
    const params = new URLSearchParams();
    if (options?.minDTE !== undefined) params.set('minDTE', options.minDTE.toString());
    if (options?.maxDTE !== undefined) params.set('maxDTE', options.maxDTE.toString());

    const queryString = params.toString();
    const url = `/api/option-chain/${encodeURIComponent(symbol)}${queryString ? `?${queryString}` : ''}`;

    const data = await fetchApi<OptionChain>(url);
    return {
      ...data,
      expirations: data.expirations.map((d) => new Date(d)),
      contracts: parseOptionContracts(data.contracts),
      asOf: new Date(data.asOf),
    };
  },

  /**
   * Get portfolio exposure by underlying
   */
  async getExposure(concentrationLimit?: number): Promise<PortfolioExposure> {
    const params = new URLSearchParams();
    if (concentrationLimit !== undefined) {
      params.set('concentrationLimit', concentrationLimit.toString());
    }

    const queryString = params.toString();
    const url = `/api/exposure${queryString ? `?${queryString}` : ''}`;

    const data = await fetchApi<PortfolioExposure>(url);
    return {
      ...data,
      calculatedAt: new Date(data.calculatedAt),
    };
  },

  /**
   * Get portfolio Greeks
   */
  async getGreeks(): Promise<PortfolioGreeks> {
    const data = await fetchApi<PortfolioGreeks>('/api/greeks');
    return {
      ...data,
      calculatedAt: new Date(data.calculatedAt),
    };
  },
};

export default api;
