/**
 * API Server for Options Trading Copilot
 *
 * Express.js server that exposes broker data endpoints for the frontend.
 * Integrates with BrokerConnectionService to fetch real-time data.
 */

import express, { Request, Response, NextFunction, Application } from 'express';
import cors from 'cors';
import type { BrokerAdapter, AccountSummary, Position, Order, OptionChainRequest, OrderRequest } from '../types/broker.js';
import { BrokerConnectionService } from '../services/broker-connection.js';
import { BrokerError, BrokerErrorCode } from '../types/errors.js';
import { addLiquidityToChain, type OptionChainWithLiquidity } from '../services/liquidity.js';
import { calculatePortfolioExposure, type PortfolioExposure } from '../services/exposure-calculator.js';
import { calculatePortfolioGreeks, type PortfolioGreeks } from '../services/portfolio-greeks.js';
import { DEFAULT_RISK_CONFIG, type RiskConfig } from '../types/risk-config.js';
import { getPortfolioSnapshot } from '../tools/portfolio-snapshot.js';
import { reviewPortfolio, formatReviewForDisplay, type PortfolioReviewResult } from '../agents/portfolio-review.js';
import { RiskEngine, type OrderValidationResult } from '../services/risk-engine.js';
import { buildDraftOrders, type BuildDraftOrdersResult, type DraftOrder } from '../services/draft-order-builder.js';
import type { TradeProposal } from '../types/trade-proposal.js';

/**
 * API response wrapper for consistent response format
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

/**
 * Portfolio data combining account, positions, and orders
 */
interface PortfolioData {
  account: AccountSummary | null;
  positions: Position[];
  orders: Order[];
  connected: boolean;
  brokerType: string | null;
}

/**
 * Connection state for the frontend
 */
interface ConnectionInfo {
  connected: boolean;
  brokerName: string | null;
  accountId: string | null;
  lastUpdated: string | null;
}

/**
 * API Server class encapsulating the Express application
 */
export class ApiServer {
  private app: Application;
  private connectionService: BrokerConnectionService;
  private port: number;
  private currentBrokerType: 'alpaca' | 'tradier' | 'tastytrade' | 'ibkr' = 'tradier';

  constructor(connectionService: BrokerConnectionService, port: number = 3001) {
    this.app = express();
    this.connectionService = connectionService;
    this.port = port;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // CORS for frontend access
    this.app.use(cors({
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
    }));

    // JSON body parsing
    this.app.use(express.json());
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json(this.wrapResponse({ status: 'ok' }));
    });

    // Connection status
    this.app.get('/api/connection', (_req: Request, res: Response) => {
      const info = this.getConnectionInfo();
      res.json(this.wrapResponse(info));
    });

    // Connect to broker
    this.app.post('/api/connect', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { brokerType } = req.body as { brokerType?: string };
        const broker = (brokerType || this.currentBrokerType) as 'alpaca' | 'tradier' | 'tastytrade' | 'ibkr';

        const result = await this.connectionService.connect(broker);

        if (result.success) {
          this.currentBrokerType = broker;
          res.json(this.wrapResponse({
            connected: true,
            accountSummary: result.accountSummary,
          }));
        } else {
          res.status(400).json(this.wrapResponse(null, result.error));
        }
      } catch (error) {
        next(error);
      }
    });

    // Disconnect from broker
    this.app.post('/api/disconnect', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        await this.connectionService.disconnect(this.currentBrokerType);
        res.json(this.wrapResponse({ disconnected: true }));
      } catch (error) {
        next(error);
      }
    });

    // Get account summary
    this.app.get('/api/account', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();
        const account = await adapter.getAccountSummary();
        res.json(this.wrapResponse(account));
      } catch (error) {
        next(error);
      }
    });

    // Get positions
    this.app.get('/api/positions', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();
        const positions = await adapter.getPositions();
        res.json(this.wrapResponse(positions));
      } catch (error) {
        next(error);
      }
    });

    // Get open orders
    this.app.get('/api/orders', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();
        const orders = await adapter.getOpenOrders();
        res.json(this.wrapResponse(orders));
      } catch (error) {
        next(error);
      }
    });

    // Get full portfolio (account + positions + orders)
    this.app.get('/api/portfolio', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.connectionService.getAdapter(this.currentBrokerType);

        if (!adapter) {
          const portfolio: PortfolioData = {
            account: null,
            positions: [],
            orders: [],
            connected: false,
            brokerType: null,
          };
          res.json(this.wrapResponse(portfolio));
          return;
        }

        // Fetch all data in parallel for performance
        const [account, positions, orders] = await Promise.all([
          adapter.getAccountSummary(),
          adapter.getPositions(),
          adapter.getOpenOrders(),
        ]);

        const portfolio: PortfolioData = {
          account,
          positions,
          orders,
          connected: true,
          brokerType: this.currentBrokerType,
        };

        res.json(this.wrapResponse(portfolio));
      } catch (error) {
        next(error);
      }
    });

    // Get option chain with liquidity scores
    this.app.get('/api/option-chain/:symbol', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();
        const symbol = req.params.symbol as string;
        const { minDTE, maxDTE } = req.query;

        const request: OptionChainRequest = {
          symbol: symbol.toUpperCase(),
          minDTE: minDTE ? parseInt(minDTE as string, 10) : undefined,
          maxDTE: maxDTE ? parseInt(maxDTE as string, 10) : undefined,
        };

        const chain = await adapter.getOptionChain(request);

        // Add liquidity scores to all contracts
        const chainWithLiquidity = addLiquidityToChain(chain);

        // Convert Map to object for JSON serialization
        const contractsObj: Record<string, unknown[]> = {};
        for (const [expiration, contracts] of chainWithLiquidity.contracts) {
          contractsObj[expiration] = contracts;
        }

        res.json(this.wrapResponse({
          underlying: chainWithLiquidity.underlying,
          underlyingPrice: chainWithLiquidity.underlyingPrice,
          expirations: chainWithLiquidity.expirations,
          contracts: contractsObj,
          asOf: chainWithLiquidity.asOf,
        }));
      } catch (error) {
        next(error);
      }
    });

    // Get portfolio exposure by underlying
    this.app.get('/api/exposure', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        // Fetch account and positions in parallel
        const [account, positions] = await Promise.all([
          adapter.getAccountSummary(),
          adapter.getPositions(),
        ]);

        // Get concentration limit from query params or use default
        const concentrationLimit = req.query.concentrationLimit
          ? parseFloat(req.query.concentrationLimit as string)
          : undefined;

        // Build risk config for exposure calculation
        const riskConfig: RiskConfig = concentrationLimit
          ? { ...DEFAULT_RISK_CONFIG, maxRiskPerUnderlyingPercent: concentrationLimit }
          : DEFAULT_RISK_CONFIG;

        // Calculate exposure
        const exposure = calculatePortfolioExposure(positions, account, riskConfig);

        res.json(this.wrapResponse({
          ...exposure,
          concentrationLimit: riskConfig.maxRiskPerUnderlyingPercent,
        }));
      } catch (error) {
        next(error);
      }
    });

    // Get portfolio Greeks
    this.app.get('/api/greeks', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        // Fetch positions
        const positions = await adapter.getPositions();

        // Calculate portfolio Greeks
        const greeks = calculatePortfolioGreeks(positions);

        res.json(this.wrapResponse(greeks));
      } catch (error) {
        next(error);
      }
    });

    // Get portfolio snapshot (MCP tool endpoint for LLM agents)
    this.app.get('/api/tools/portfolio-snapshot', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        // Parse optional query parameters
        const concentrationLimit = req.query.concentrationLimit
          ? parseFloat(req.query.concentrationLimit as string)
          : undefined;

        // Build the snapshot
        const snapshot = await getPortfolioSnapshot(adapter, { concentrationLimit });

        res.json(this.wrapResponse(snapshot));
      } catch (error) {
        next(error);
      }
    });

    // Chat - Generate portfolio review
    this.app.post('/api/chat/review', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        // Build portfolio snapshot for review
        const snapshot = await getPortfolioSnapshot(adapter);

        // Run portfolio review
        const review = reviewPortfolio(snapshot);

        // Format for display
        const formattedReview = formatReviewForDisplay(review);

        res.json(this.wrapResponse({
          review,
          formattedReview,
        }));
      } catch (error) {
        next(error);
      }
    });

    // Validate orders against risk rules
    this.app.post('/api/orders/validate', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();
        const { proposal } = req.body as { proposal: TradeProposal };

        if (!proposal) {
          res.status(400).json(this.wrapResponse(null, 'Missing proposal in request body'));
          return;
        }

        // Fetch current portfolio state in parallel
        const [account, positions] = await Promise.all([
          adapter.getAccountSummary(),
          adapter.getPositions(),
        ]);

        // Build draft orders from the proposal
        const draftOrdersResult = buildDraftOrders(proposal);

        // Validate each order against risk rules
        const riskEngine = new RiskEngine();
        const validationResults: OrderValidationResult[] = [];
        let allValid = true;

        for (const draftOrder of draftOrdersResult.orders) {
          // Try to get quote for liquidity check (optional)
          let quote = undefined;
          try {
            quote = await adapter.getQuote(draftOrder.orderRequest.symbol);
          } catch {
            // Quote fetch failed, proceed without liquidity check
          }

          const validation = riskEngine.validateOrder(draftOrder.orderRequest, {
            config: DEFAULT_RISK_CONFIG,
            account,
            positions,
            quote,
          });

          validationResults.push(validation);
          if (!validation.valid) {
            allValid = false;
          }
        }

        // Combine validation results
        const combinedChecks = validationResults.flatMap(v => v.checks);
        const combinedRejections = validationResults.flatMap(v => v.rejectionReasons);
        const uniqueRejections = [...new Set(combinedRejections)];

        const combinedValidation: OrderValidationResult = {
          valid: allValid,
          checks: combinedChecks,
          rejectionReasons: uniqueRejections,
          validatedAt: new Date(),
          order: draftOrdersResult.orders[0]?.orderRequest || {} as OrderRequest,
        };

        // Format draft orders for UI
        const formattedOrders = draftOrdersResult.orders.map((order) => ({
          description: `${order.orderRequest.side.toUpperCase()} ${order.orderRequest.quantity}x ${order.contractInfo.underlying}`,
          side: order.orderRequest.side,
          quantity: order.orderRequest.quantity,
          underlying: order.contractInfo.underlying,
          strike: order.contractInfo.strike,
          expiration: order.contractInfo.expiration.toISOString(),
          optionType: order.contractInfo.optionType,
          limitPrice: order.orderRequest.limitPrice,
          estimatedCost: order.estimatedCost,
          idempotencyKey: order.idempotencyKey,
        }));

        res.json(this.wrapResponse({
          orders: formattedOrders,
          totalEstimatedCost: draftOrdersResult.totalEstimatedCost,
          validation: {
            ...combinedValidation,
            validatedAt: combinedValidation.validatedAt.toISOString(),
          },
          warnings: draftOrdersResult.warnings,
          correlationId: draftOrdersResult.correlationId,
        }));
      } catch (error) {
        next(error);
      }
    });

    // Refresh all data (alias for portfolio)
    this.app.post('/api/refresh', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        const [account, positions, orders] = await Promise.all([
          adapter.getAccountSummary(),
          adapter.getPositions(),
          adapter.getOpenOrders(),
        ]);

        const portfolio: PortfolioData = {
          account,
          positions,
          orders,
          connected: true,
          brokerType: this.currentBrokerType,
        };

        res.json(this.wrapResponse(portfolio));
      } catch (error) {
        next(error);
      }
    });
  }

  /**
   * Setup error handling middleware
   */
  private setupErrorHandling(): void {
    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('API Error:', err.message);

      if (err instanceof BrokerError) {
        const statusCode = this.getStatusCodeForBrokerError(err);
        res.status(statusCode).json(this.wrapResponse(null, err.toUserMessage()));
        return;
      }

      if (err.message === 'Not connected to broker') {
        res.status(503).json(this.wrapResponse(null, 'Not connected to broker. Please connect first.'));
        return;
      }

      res.status(500).json(this.wrapResponse(null, 'An internal error occurred'));
    });
  }

  /**
   * Get the broker adapter or throw an error
   */
  private getAdapterOrThrow(): BrokerAdapter {
    const adapter = this.connectionService.getAdapter(this.currentBrokerType);
    if (!adapter) {
      throw new Error('Not connected to broker');
    }
    return adapter;
  }

  /**
   * Get connection info for the frontend
   */
  private getConnectionInfo(): ConnectionInfo {
    const adapter = this.connectionService.getAdapter(this.currentBrokerType);
    const state = this.connectionService.getConnectionState(this.currentBrokerType);

    // Use account ID from connection state or format a display-friendly version
    const accountId = state?.accountSummary
      ? `${this.currentBrokerType.toUpperCase()}-${state.lastConnected?.getTime().toString(36).toUpperCase().slice(-6) ?? 'ACTIVE'}`
      : null;

    return {
      connected: adapter !== null,
      brokerName: adapter ? adapter.brokerName : null,
      accountId,
      lastUpdated: state?.lastConnected?.toISOString() ?? null,
    };
  }

  /**
   * Map BrokerError to HTTP status code
   */
  private getStatusCodeForBrokerError(err: BrokerError): number {
    switch (err.code) {
      case BrokerErrorCode.INVALID_CREDENTIALS:
      case BrokerErrorCode.TOKEN_EXPIRED:
      case BrokerErrorCode.AUTHENTICATION_FAILED:
        return 401;
      case BrokerErrorCode.RATE_LIMIT_EXCEEDED:
        return 429;
      case BrokerErrorCode.INVALID_ORDER:
      case BrokerErrorCode.SYMBOL_NOT_FOUND:
        return 400;
      case BrokerErrorCode.INSUFFICIENT_FUNDS:
      case BrokerErrorCode.ORDER_NOT_FOUND:
      case BrokerErrorCode.POSITION_NOT_FOUND:
        return 404;
      case BrokerErrorCode.SERVICE_UNAVAILABLE:
      case BrokerErrorCode.CONNECTION_FAILED:
        return 503;
      default:
        return 500;
    }
  }

  /**
   * Wrap response data in standard API response format
   */
  private wrapResponse<T>(data: T | null, error?: string): ApiResponse<T> {
    if (error) {
      return {
        success: false,
        error,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      success: true,
      data: data as T,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get the Express application (for testing)
   */
  getApp(): Application {
    return this.app;
  }

  /**
   * Start the server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(`API server running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }
}

/**
 * Create and configure the API server
 */
export function createApiServer(
  connectionService: BrokerConnectionService,
  port?: number
): ApiServer {
  return new ApiServer(connectionService, port);
}
