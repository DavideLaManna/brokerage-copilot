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
import { OrderSubmissionService, type BatchSubmissionResult, type OrderSubmissionResult } from '../services/order-submission.js';
import { OrderSubmissionStore } from '../storage/order-submissions.js';
import { TradeProposalService } from '../services/trade-proposal.js';
import { AuditLogService } from '../services/audit-log.js';
import type { AuditEventType, AuditLogQueryOptions, StoredAuditLogEntry } from '../types/audit-log.js';
import { AlertMonitorService, createAlertMonitorService } from '../services/alert-monitor.js';
import { MarketDataService, createMarketDataService } from '../services/market-data.js';
import { AlertActionProposalsService, createAlertActionProposalsService, type AlertWithProposals, type AlertProposalResult } from '../services/alert-action-proposals.js';
import { KillSwitchService, createKillSwitchService, shouldBlockOperation, getBlockedOperationMessage } from '../services/kill-switch.js';
import type { KillSwitchStatus, KillSwitchActivationResult, KillSwitchDeactivationResult, KillSwitchConfig, KillSwitchReasonCategory, KillSwitchActivator } from '../types/kill-switch.js';

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
/**
 * Order execution result returned from /api/orders/execute
 */
interface OrderExecutionResult {
  /** Whether execution was successful */
  success: boolean;
  /** Overall status of the execution */
  status: 'executed' | 'partially_executed' | 'failed' | 'validation_failed';
  /** Proposal ID that was executed */
  proposalId?: string;
  /** Correlation ID for tracking */
  correlationId: string;
  /** Individual order results */
  orderResults: OrderSubmissionResult[];
  /** Summary of execution */
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  /** Combined broker order IDs (for successful orders) */
  brokerOrderIds: string[];
  /** Error message if execution failed */
  errorMessage?: string;
  /** Timestamp of execution */
  executedAt: string;
}

export class ApiServer {
  private app: Application;
  private connectionService: BrokerConnectionService;
  private submissionStore: OrderSubmissionStore | null = null;
  private proposalService: TradeProposalService | null = null;
  private auditLogService: AuditLogService | null = null;
  private alertService: AlertMonitorService | null = null;
  private alertProposalsService: AlertActionProposalsService | null = null;
  private killSwitchService: KillSwitchService | null = null;
  private port: number;
  private currentBrokerType: 'alpaca' | 'tradier' | 'tastytrade' | 'ibkr' = 'tradier';

  constructor(connectionService: BrokerConnectionService, port: number = 3001, submissionStore?: OrderSubmissionStore, proposalService?: TradeProposalService, auditLogService?: AuditLogService) {
    this.app = express();
    this.connectionService = connectionService;
    this.submissionStore = submissionStore ?? null;
    this.proposalService = proposalService ?? null;
    this.auditLogService = auditLogService ?? null;
    this.port = port;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Set the order submission store (can be called after construction)
   */
  setSubmissionStore(store: OrderSubmissionStore): void {
    this.submissionStore = store;
  }

  /**
   * Set the trade proposal service (can be called after construction)
   */
  setProposalService(service: TradeProposalService): void {
    this.proposalService = service;
  }

  /**
   * Set the audit log service (can be called after construction)
   */
  setAuditLogService(service: AuditLogService): void {
    this.auditLogService = service;
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

    // Submit orders to broker (with idempotency)
    this.app.post('/api/orders/submit', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        if (!this.submissionStore) {
          res.status(503).json(this.wrapResponse(null, 'Order submission service not configured'));
          return;
        }

        const { orders, correlationId, proposalId } = req.body as {
          orders: Array<{
            orderRequest: OrderRequest;
            idempotencyKey: string;
            proposalId?: string;
            legIndex: number;
            contractInfo: {
              underlying: string;
              strike: number;
              expiration: string;
              optionType: 'call' | 'put';
              side: 'buy' | 'sell';
              quantity: number;
              targetPrice?: number;
            };
            estimatedCost: number;
          }>;
          correlationId: string;
          proposalId?: string;
        };

        if (!orders || !Array.isArray(orders) || orders.length === 0) {
          res.status(400).json(this.wrapResponse(null, 'Missing or empty orders array in request body'));
          return;
        }

        if (!correlationId) {
          res.status(400).json(this.wrapResponse(null, 'Missing correlationId in request body'));
          return;
        }

        // Get account ID for submission tracking
        // Use broker type as account identifier (in production, this would come from credentials)
        const accountId = this.currentBrokerType;

        // Convert request orders to DraftOrder format
        const draftOrders: DraftOrder[] = orders.map(order => ({
          orderRequest: {
            ...order.orderRequest,
            optionDetails: order.orderRequest.optionDetails ? {
              ...order.orderRequest.optionDetails,
              expiration: new Date(order.orderRequest.optionDetails.expiration),
            } : undefined,
          },
          idempotencyKey: order.idempotencyKey,
          proposalId: order.proposalId ?? proposalId,
          legIndex: order.legIndex,
          contractInfo: {
            ...order.contractInfo,
            expiration: new Date(order.contractInfo.expiration),
          },
          estimatedCost: order.estimatedCost,
          createdAt: new Date(),
        }));

        // Build result object for submission service
        const draftOrdersResult: BuildDraftOrdersResult = {
          orders: draftOrders,
          warnings: [],
          totalEstimatedCost: orders.reduce((sum, o) => sum + o.estimatedCost, 0),
          correlationId,
          proposalId,
        };

        // Create submission service and submit orders
        const submissionService = new OrderSubmissionService(
          adapter,
          this.submissionStore,
          accountId
        );

        const result = await submissionService.submitOrders(draftOrdersResult);

        res.json(this.wrapResponse(result));
      } catch (error) {
        next(error);
      }
    });

    // Execute orders: validate → submit → update proposal status
    // This is the full execution flow triggered by user approval
    this.app.post('/api/orders/execute', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        if (!this.submissionStore) {
          res.status(503).json(this.wrapResponse(null, 'Order submission service not configured'));
          return;
        }

        const { orders, correlationId, proposalId, proposal } = req.body as {
          orders: Array<{
            orderRequest: OrderRequest;
            idempotencyKey: string;
            proposalId?: string;
            legIndex: number;
            contractInfo: {
              underlying: string;
              strike: number;
              expiration: string;
              optionType: 'call' | 'put';
              side: 'buy' | 'sell';
              quantity: number;
              targetPrice?: number;
            };
            estimatedCost: number;
          }>;
          correlationId: string;
          proposalId?: string;
          proposal?: TradeProposal;
        };

        if (!orders || !Array.isArray(orders) || orders.length === 0) {
          res.status(400).json(this.wrapResponse(null, 'Missing or empty orders array in request body'));
          return;
        }

        if (!correlationId) {
          res.status(400).json(this.wrapResponse(null, 'Missing correlationId in request body'));
          return;
        }

        const accountId = this.currentBrokerType;

        // Step 1: Pre-trade validation
        const [account, positions] = await Promise.all([
          adapter.getAccountSummary(),
          adapter.getPositions(),
        ]);

        const riskEngine = new RiskEngine();
        const validationResults: OrderValidationResult[] = [];
        let allValid = true;

        for (const order of orders) {
          // Try to get quote for liquidity check (optional)
          let quote = undefined;
          try {
            quote = await adapter.getQuote(order.orderRequest.symbol);
          } catch {
            // Quote fetch failed, proceed without liquidity check
          }

          const validation = riskEngine.validateOrder(order.orderRequest, {
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

        // If validation fails, return error and don't submit
        if (!allValid) {
          const rejectionReasons = validationResults.flatMap(v => v.rejectionReasons);
          const uniqueRejections = [...new Set(rejectionReasons)];

          const result: OrderExecutionResult = {
            success: false,
            status: 'validation_failed',
            proposalId,
            correlationId,
            orderResults: [],
            summary: { total: orders.length, succeeded: 0, failed: orders.length },
            brokerOrderIds: [],
            errorMessage: `Pre-trade validation failed: ${uniqueRejections.join('; ')}`,
            executedAt: new Date().toISOString(),
          };

          res.status(400).json(this.wrapResponse(result));
          return;
        }

        // Step 2: Submit orders to broker
        const draftOrders: DraftOrder[] = orders.map(order => ({
          orderRequest: {
            ...order.orderRequest,
            optionDetails: order.orderRequest.optionDetails ? {
              ...order.orderRequest.optionDetails,
              expiration: new Date(order.orderRequest.optionDetails.expiration),
            } : undefined,
          },
          idempotencyKey: order.idempotencyKey,
          proposalId: order.proposalId ?? proposalId,
          legIndex: order.legIndex,
          contractInfo: {
            ...order.contractInfo,
            expiration: new Date(order.contractInfo.expiration),
          },
          estimatedCost: order.estimatedCost,
          createdAt: new Date(),
        }));

        const draftOrdersResult: BuildDraftOrdersResult = {
          orders: draftOrders,
          warnings: [],
          totalEstimatedCost: orders.reduce((sum, o) => sum + o.estimatedCost, 0),
          correlationId,
          proposalId,
        };

        const submissionService = new OrderSubmissionService(
          adapter,
          this.submissionStore,
          accountId
        );

        const batchResult = await submissionService.submitOrders(draftOrdersResult);

        // Step 3: Determine execution status and update proposal
        const succeededOrders = batchResult.results.filter(r => r.success);
        const brokerOrderIds = succeededOrders
          .filter(r => r.orderId)
          .map(r => r.orderId as string);

        let status: OrderExecutionResult['status'];
        if (batchResult.success) {
          status = 'executed';
        } else if (succeededOrders.length > 0) {
          status = 'partially_executed';
        } else {
          status = 'failed';
        }

        // Step 4: Update proposal status if we have a proposal service and proposal ID
        if (this.proposalService && proposalId) {
          try {
            if (status === 'executed') {
              // Mark as executed with the first broker order ID
              await this.proposalService.markExecuted(
                accountId,
                proposalId,
                brokerOrderIds[0] || correlationId,
                `Executed via API. Order IDs: ${brokerOrderIds.join(', ')}`
              );
            } else if (status === 'failed') {
              // Reject the proposal with failure reason
              const errorMessages = batchResult.results
                .filter(r => !r.success && r.errorMessage)
                .map(r => r.errorMessage);
              await this.proposalService.rejectProposal(
                accountId,
                proposalId,
                `Execution failed: ${errorMessages.join('; ')}`,
                'Order submission failed'
              );
            }
            // For partially_executed, we don't update status - requires manual review
          } catch (proposalError) {
            // Log but don't fail the response - orders were submitted
            console.error('Failed to update proposal status:', proposalError);
          }
        }

        // Build execution result
        const executionResult: OrderExecutionResult = {
          success: batchResult.success,
          status,
          proposalId,
          correlationId,
          orderResults: batchResult.results,
          summary: batchResult.summary,
          brokerOrderIds,
          errorMessage: batchResult.success
            ? undefined
            : batchResult.results.find(r => !r.success)?.errorMessage,
          executedAt: batchResult.submittedAt,
        };

        res.json(this.wrapResponse(executionResult));
      } catch (error) {
        next(error);
      }
    });

    // Cancel an order by ID
    this.app.delete('/api/orders/:orderId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();
        const orderId = req.params.orderId as string;

        if (!orderId) {
          res.status(400).json(this.wrapResponse(null, 'Missing orderId parameter'));
          return;
        }

        // Log the cancellation attempt
        console.log(`[ORDER CANCEL] Attempting to cancel order ${orderId}`);

        // Attempt to cancel the order
        const success = await adapter.cancelOrder(orderId);

        if (success) {
          console.log(`[ORDER CANCEL] Successfully canceled order ${orderId}`);
          res.json(this.wrapResponse({
            canceled: true,
            orderId,
            message: `Order ${orderId} has been canceled`,
          }));
        } else {
          console.log(`[ORDER CANCEL] Failed to cancel order ${orderId} - order may already be filled or canceled`);
          res.status(400).json(this.wrapResponse(null, `Unable to cancel order ${orderId}. It may already be filled or canceled.`));
        }
      } catch (error) {
        console.error(`[ORDER CANCEL] Error canceling order:`, error);
        next(error);
      }
    });

    // Get order submission status by idempotency key
    this.app.get('/api/orders/status/:idempotencyKey', async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.submissionStore) {
          res.status(503).json(this.wrapResponse(null, 'Order submission service not configured'));
          return;
        }

        const idempotencyKey = req.params.idempotencyKey as string;

        if (!idempotencyKey) {
          res.status(400).json(this.wrapResponse(null, 'Missing idempotencyKey parameter'));
          return;
        }

        // Get account ID for submission tracking
        // Use broker type as account identifier (in production, this would come from credentials)
        const accountId = this.currentBrokerType;

        const submission = await this.submissionStore.getSubmission(accountId, idempotencyKey);

        if (!submission) {
          res.status(404).json(this.wrapResponse(null, 'Submission not found'));
          return;
        }

        res.json(this.wrapResponse(submission));
      } catch (error) {
        next(error);
      }
    });

    // ===========================================================================
    // Exit Ladder Endpoints
    // ===========================================================================

    // Preview an exit ladder for a position
    this.app.post('/api/exit-ladder/preview', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();
        const { positionId, rungs } = req.body;

        if (!positionId || !rungs || !Array.isArray(rungs)) {
          res.status(400).json(this.wrapResponse(null, 'Missing required parameters: positionId and rungs'));
          return;
        }

        // Validate rungs
        for (const rung of rungs) {
          if (typeof rung.targetProfitPercent !== 'number' || typeof rung.closePercent !== 'number') {
            res.status(400).json(this.wrapResponse(null, 'Invalid rung format: each rung must have targetProfitPercent and closePercent'));
            return;
          }
        }

        // Get positions to find the target position
        const positions = await adapter.getPositions();
        const position = positions.find(p => p.id === positionId);

        if (!position) {
          res.status(404).json(this.wrapResponse(null, 'Position not found'));
          return;
        }

        // Import the exit ladder builder dynamically
        const { proposeExitLadder } = await import('../services/exit-ladder-builder.js');

        // Get account for validation context
        const account = await adapter.getAccountSummary();
        const otherPositions = positions.filter(p => p.id !== positionId);

        // Build the exit ladder proposal
        const proposal = proposeExitLadder(
          position,
          { rungs },
          {
            riskConfig: DEFAULT_RISK_CONFIG,
            account,
            otherPositions,
          }
        );

        // Convert proposal for JSON response
        const responseProposal = {
          ...proposal,
          createdAt: proposal.createdAt.toISOString(),
          orders: proposal.orders.map(order => ({
            rungIndex: order.rungIndex,
            targetProfitPercent: order.targetProfitPercent,
            exitPrice: order.exitPrice,
            contractsToClose: order.contractsToClose,
            estimatedCredit: order.estimatedCredit,
            estimatedProfit: order.estimatedProfit,
            currentPrice: order.currentPrice,
            costBasis: order.costBasis,
            validationPassed: order.validationResult?.valid ?? true,
            validationMessage: order.validationResult?.rejectionReasons?.join(', '),
          })),
        };

        res.json(this.wrapResponse(responseProposal));
      } catch (error) {
        next(error);
      }
    });

    // Submit exit ladder orders
    this.app.post('/api/exit-ladder/submit', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const adapter = this.getAdapterOrThrow();

        if (!this.submissionStore) {
          res.status(503).json(this.wrapResponse(null, 'Order submission service not configured'));
          return;
        }

        const { proposalId, positionId, rungs } = req.body;

        if (!positionId || !rungs || !Array.isArray(rungs)) {
          res.status(400).json(this.wrapResponse(null, 'Missing required parameters: positionId and rungs'));
          return;
        }

        // Get positions to find the target position
        const positions = await adapter.getPositions();
        const position = positions.find(p => p.id === positionId);

        if (!position) {
          res.status(404).json(this.wrapResponse(null, 'Position not found'));
          return;
        }

        // Import the exit ladder builder and submission service dynamically
        const { proposeExitLadder, toBuiltDraftOrdersResult } = await import('../services/exit-ladder-builder.js');

        // Get account for validation context
        const account = await adapter.getAccountSummary();
        const otherPositions = positions.filter(p => p.id !== positionId);

        // Build the exit ladder proposal
        const proposal = proposeExitLadder(
          position,
          { rungs },
          {
            riskConfig: DEFAULT_RISK_CONFIG,
            account,
            otherPositions,
          }
        );

        // Check if validation passed
        if (!proposal.validationSummary.allPassed) {
          res.status(400).json(this.wrapResponse(null, 'Exit ladder validation failed: ' + proposal.validationSummary.failureReasons.join(', ')));
          return;
        }

        // Convert to draft orders result for submission
        const draftOrdersResult = toBuiltDraftOrdersResult(proposal);

        // Create submission service
        const accountId = this.currentBrokerType;
        const submissionService = new OrderSubmissionService(
          adapter,
          this.submissionStore,
          accountId
        );

        // Submit all orders
        const batchResult = await submissionService.submitOrders(draftOrdersResult);

        // Log the submission
        console.log(`[EXIT LADDER] Submitted ${draftOrdersResult.orders.length} exit ladder orders for position ${positionId}`, {
          proposalId: proposal.proposalId,
          correlationId: proposal.correlationId,
          success: batchResult.success,
          succeeded: batchResult.summary.succeeded,
          failed: batchResult.summary.failed,
        });

        // Build response
        const response = {
          success: batchResult.success,
          proposalId: proposal.proposalId,
          correlationId: proposal.correlationId,
          orderResults: batchResult.results,
          summary: batchResult.summary,
          brokerOrderIds: batchResult.results
            .filter((r: OrderSubmissionResult) => r.success && r.orderId)
            .map((r: OrderSubmissionResult) => r.orderId!),
          submittedAt: batchResult.submittedAt,
        };

        res.json(this.wrapResponse(response));
      } catch (error) {
        console.error('[EXIT LADDER] Error submitting exit ladder:', error);
        next(error);
      }
    });

    // ===========================================================================
    // Decision Journal Endpoints
    // ===========================================================================

    // Get journal entries (audit log entries grouped by day)
    this.app.get('/api/journal/entries', async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.auditLogService) {
          res.status(503).json(this.wrapResponse(null, 'Audit log service not configured'));
          return;
        }

        const accountId = this.currentBrokerType;

        // Parse query parameters
        const queryOptions: AuditLogQueryOptions = {};

        if (req.query.eventTypes) {
          const typesParam = req.query.eventTypes as string;
          queryOptions.eventTypes = typesParam.split(',') as AuditEventType[];
        }

        if (req.query.actor) {
          queryOptions.actor = req.query.actor as 'user' | 'agent' | 'system' | 'broker';
        }

        if (req.query.startDate) {
          queryOptions.startDate = req.query.startDate as string;
        }

        if (req.query.endDate) {
          queryOptions.endDate = req.query.endDate as string;
        }

        if (req.query.limit) {
          queryOptions.limit = parseInt(req.query.limit as string, 10);
        }

        if (req.query.offset) {
          queryOptions.offset = parseInt(req.query.offset as string, 10);
        }

        queryOptions.sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc';

        // Get entries grouped by day
        const groupedEntries = this.auditLogService.getEntriesGroupedByDay(accountId, queryOptions);

        // Convert Map to array of day groups for JSON serialization
        const dayGroups: Array<{ date: string; entries: StoredAuditLogEntry[] }> = [];
        for (const [date, entries] of groupedEntries) {
          dayGroups.push({ date, entries });
        }

        // Get statistics
        const statistics = this.auditLogService.getStatistics(accountId);

        res.json(this.wrapResponse({
          dayGroups,
          statistics,
          queryOptions,
        }));
      } catch (error) {
        next(error);
      }
    });

    // Get a single journal entry by ID
    this.app.get('/api/journal/entries/:entryId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.auditLogService) {
          res.status(503).json(this.wrapResponse(null, 'Audit log service not configured'));
          return;
        }

        const accountId = this.currentBrokerType;
        const entryId = req.params.entryId as string;

        const entry = this.auditLogService.getEntry(accountId, entryId);

        if (!entry) {
          res.status(404).json(this.wrapResponse(null, 'Entry not found'));
          return;
        }

        res.json(this.wrapResponse(entry));
      } catch (error) {
        next(error);
      }
    });

    // Get entries for a specific proposal
    this.app.get('/api/journal/proposals/:proposalId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.auditLogService) {
          res.status(503).json(this.wrapResponse(null, 'Audit log service not configured'));
          return;
        }

        const accountId = this.currentBrokerType;
        const proposalId = req.params.proposalId as string;

        const entries = this.auditLogService.getProposalHistory(accountId, proposalId);

        res.json(this.wrapResponse({
          proposalId,
          entries,
          count: entries.length,
        }));
      } catch (error) {
        next(error);
      }
    });

    // Add a note to a journal entry
    this.app.post('/api/journal/entries/:entryId/notes', async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.auditLogService) {
          res.status(503).json(this.wrapResponse(null, 'Audit log service not configured'));
          return;
        }

        const accountId = this.currentBrokerType;
        const entryId = req.params.entryId as string;
        const { text } = req.body as { text: string };

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
          res.status(400).json(this.wrapResponse(null, 'Note text is required'));
          return;
        }

        const updatedEntry = await this.auditLogService.addNote(accountId, entryId, text.trim());

        if (!updatedEntry) {
          res.status(404).json(this.wrapResponse(null, 'Entry not found'));
          return;
        }

        res.json(this.wrapResponse(updatedEntry));
      } catch (error) {
        next(error);
      }
    });

    // Update a note on a journal entry
    this.app.put('/api/journal/entries/:entryId/notes/:noteId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.auditLogService) {
          res.status(503).json(this.wrapResponse(null, 'Audit log service not configured'));
          return;
        }

        const accountId = this.currentBrokerType;
        const entryId = req.params.entryId as string;
        const noteId = req.params.noteId as string;
        const { text } = req.body as { text: string };

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
          res.status(400).json(this.wrapResponse(null, 'Note text is required'));
          return;
        }

        const updatedEntry = await this.auditLogService.updateNote(accountId, entryId, noteId, text.trim());

        if (!updatedEntry) {
          res.status(404).json(this.wrapResponse(null, 'Entry or note not found'));
          return;
        }

        res.json(this.wrapResponse(updatedEntry));
      } catch (error) {
        next(error);
      }
    });

    // Delete a note from a journal entry
    this.app.delete('/api/journal/entries/:entryId/notes/:noteId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.auditLogService) {
          res.status(503).json(this.wrapResponse(null, 'Audit log service not configured'));
          return;
        }

        const accountId = this.currentBrokerType;
        const entryId = req.params.entryId as string;
        const noteId = req.params.noteId as string;

        const updatedEntry = await this.auditLogService.deleteNote(accountId, entryId, noteId);

        if (!updatedEntry) {
          res.status(404).json(this.wrapResponse(null, 'Entry or note not found'));
          return;
        }

        res.json(this.wrapResponse(updatedEntry));
      } catch (error) {
        next(error);
      }
    });

    // Get journal statistics
    this.app.get('/api/journal/statistics', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        if (!this.auditLogService) {
          res.status(503).json(this.wrapResponse(null, 'Audit log service not configured'));
          return;
        }

        const accountId = this.currentBrokerType;
        const statistics = this.auditLogService.getStatistics(accountId);

        res.json(this.wrapResponse(statistics));
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

    // =========================================================================
    // Alert Endpoints (US-032)
    // =========================================================================

    // Get all alerts (for notification center)
    this.app.get('/api/alerts', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          // Return empty data if no alert service configured
          res.json(this.wrapResponse({
            alerts: [],
            preferences: {
              alertsEnabled: false,
              minimumSeverity: 'info' as const,
            },
            statistics: {
              totalTriggers: 0,
              enabledTriggers: 0,
              totalAlerts: 0,
              activeAlerts: 0,
              acknowledgedAlerts: 0,
              dismissedAlerts: 0,
              resolvedAlerts: 0,
              alertsBySeverity: { info: 0, warning: 0, critical: 0 },
              alertsByType: {},
              isPolling: false,
            },
          }));
          return;
        }

        const showDismissed = req.query.showDismissed === 'true';
        const alerts = showDismissed
          ? alertService.getAllAlerts()
          : alertService.getVisibleAlerts();

        res.json(this.wrapResponse({
          alerts,
          preferences: alertService.getPreferences(),
          statistics: alertService.getStatistics(),
        }));
      } catch (error) {
        next(error);
      }
    });

    // Get all alert triggers
    this.app.get('/api/alerts/triggers', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.json(this.wrapResponse({ triggers: [] }));
          return;
        }

        res.json(this.wrapResponse({
          triggers: alertService.getAllTriggers(),
        }));
      } catch (error) {
        next(error);
      }
    });

    // Create a new alert trigger
    this.app.post('/api/alerts/triggers', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const { name, description, config } = req.body;
        if (!name || !config) {
          res.status(400).json(this.wrapResponse(null, 'Missing required fields: name, config'));
          return;
        }

        const trigger = alertService.createTrigger(name, description ?? '', config);
        res.status(201).json(this.wrapResponse(trigger));
      } catch (error) {
        if (error instanceof Error && error.message.includes('Invalid trigger config')) {
          res.status(400).json(this.wrapResponse(null, error.message));
          return;
        }
        next(error);
      }
    });

    // Update an alert trigger
    this.app.put('/api/alerts/triggers/:triggerId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const triggerId = req.params.triggerId as string;
        const updates = req.body;

        const trigger = alertService.updateTrigger(triggerId, updates);
        res.json(this.wrapResponse(trigger));
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          res.status(404).json(this.wrapResponse(null, error.message));
          return;
        }
        next(error);
      }
    });

    // Delete an alert trigger
    this.app.delete('/api/alerts/triggers/:triggerId', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const triggerId = req.params.triggerId as string;
        const deleted = alertService.deleteTrigger(triggerId);

        if (!deleted) {
          res.status(404).json(this.wrapResponse(null, 'Trigger not found'));
          return;
        }

        res.json(this.wrapResponse({ deleted: true }));
      } catch (error) {
        next(error);
      }
    });

    // Acknowledge an alert
    this.app.post('/api/alerts/:alertId/acknowledge', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const alertId = req.params.alertId as string;
        const alert = alertService.acknowledgeAlert(alertId);

        if (!alert) {
          res.status(404).json(this.wrapResponse(null, 'Alert not found'));
          return;
        }

        res.json(this.wrapResponse(alert));
      } catch (error) {
        next(error);
      }
    });

    // Dismiss an alert
    this.app.post('/api/alerts/:alertId/dismiss', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const alertId = req.params.alertId as string;
        const alert = alertService.dismissAlert(alertId);

        if (!alert) {
          res.status(404).json(this.wrapResponse(null, 'Alert not found'));
          return;
        }

        res.json(this.wrapResponse(alert));
      } catch (error) {
        next(error);
      }
    });

    // Dismiss all alerts
    this.app.post('/api/alerts/dismiss-all', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const count = alertService.dismissAllAlerts();
        res.json(this.wrapResponse({ dismissedCount: count }));
      } catch (error) {
        next(error);
      }
    });

    // Run alert scan manually
    this.app.post('/api/alerts/scan', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const result = await alertService.scan();
        res.json(this.wrapResponse(result));
      } catch (error) {
        next(error);
      }
    });

    // Update alert preferences
    this.app.put('/api/alerts/preferences', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const updates = req.body;
        const preferences = alertService.updatePreferences(updates);
        res.json(this.wrapResponse(preferences));
      } catch (error) {
        next(error);
      }
    });

    // Start/stop alert polling
    this.app.post('/api/alerts/polling/:action', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const { action } = req.params;
        if (action === 'start') {
          alertService.startPolling();
        } else if (action === 'stop') {
          alertService.stopPolling();
        } else {
          res.status(400).json(this.wrapResponse(null, 'Invalid action. Use "start" or "stop"'));
          return;
        }

        res.json(this.wrapResponse({
          isPolling: alertService.isPollingActive(),
          lastScanAt: alertService.getLastScanTime(),
        }));
      } catch (error) {
        next(error);
      }
    });

    // Generate proposals for an alert - POST /api/alerts/:alertId/proposals
    this.app.post('/api/alerts/:alertId/proposals', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertService = this.getAlertService();
        if (!alertService) {
          res.status(503).json(this.wrapResponse(null, 'Alert service not configured'));
          return;
        }

        const alertProposalsService = this.getAlertProposalsService();
        if (!alertProposalsService) {
          res.status(503).json(this.wrapResponse(null, 'Alert proposals service not configured'));
          return;
        }

        const { alertId } = req.params;
        const alert = alertService.getAlert(alertId as string);

        if (!alert) {
          res.status(404).json(this.wrapResponse(null, 'Alert not found'));
          return;
        }

        const { closePercent, orderType } = req.body as { closePercent?: number; orderType?: 'limit' | 'market' };

        const result = await alertProposalsService.generateProposalsForAlert(alert, {
          closePercent,
          orderType,
        });

        res.json(this.wrapResponse({
          alertId: result.alert.id,
          correlationId: result.correlationId,
          proposals: result.proposals.map((p) => ({
            success: p.success,
            proposalId: p.proposal?.id,
            action: p.action,
            error: p.error,
            generatedAt: p.generatedAt.toISOString(),
          })),
          successCount: result.proposals.filter((p) => p.success).length,
          failureCount: result.proposals.filter((p) => !p.success).length,
        }));
      } catch (error) {
        next(error);
      }
    });

    // Get proposals for an alert - GET /api/alerts/:alertId/proposals
    this.app.get('/api/alerts/:alertId/proposals', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const alertProposalsService = this.getAlertProposalsService();
        if (!alertProposalsService) {
          res.status(503).json(this.wrapResponse(null, 'Alert proposals service not configured'));
          return;
        }

        const { alertId } = req.params;
        const result = alertProposalsService.getProposalsForAlert(alertId as string);

        if (!result) {
          res.status(404).json(this.wrapResponse(null, 'No proposals found for this alert'));
          return;
        }

        res.json(this.wrapResponse({
          alertId: result.alert.id,
          correlationId: result.correlationId,
          proposals: result.proposals.map((p) => ({
            success: p.success,
            proposal: p.proposal ? {
              id: p.proposal.id,
              status: p.proposal.status,
              strategyType: p.proposal.proposal.strategyType,
              underlying: p.proposal.proposal.underlying,
              contracts: p.proposal.proposal.contracts.length,
              confidence: p.proposal.proposal.confidence,
              createdAt: p.proposal.createdAt.toISOString(),
            } : undefined,
            action: p.action,
            error: p.error,
            generatedAt: p.generatedAt.toISOString(),
          })),
        }));
      } catch (error) {
        next(error);
      }
    });

    // Get all alert proposals - GET /api/alerts/proposals
    this.app.get('/api/alerts/proposals', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const alertProposalsService = this.getAlertProposalsService();
        if (!alertProposalsService) {
          res.status(503).json(this.wrapResponse(null, 'Alert proposals service not configured'));
          return;
        }

        const allProposals = alertProposalsService.getAllAlertProposals();

        res.json(this.wrapResponse({
          total: allProposals.length,
          alertProposals: allProposals.map((ap) => ({
            alertId: ap.alert.id,
            alertTitle: ap.alert.title,
            alertSeverity: ap.alert.severity,
            correlationId: ap.correlationId,
            proposalCount: ap.proposals.length,
            successCount: ap.proposals.filter((p) => p.success).length,
          })),
        }));
      } catch (error) {
        next(error);
      }
    });

    // =========================================================================
    // Kill Switch Endpoints (US-040)
    // =========================================================================

    // Get kill switch status
    this.app.get('/api/kill-switch', (_req: Request, res: Response) => {
      const killSwitchService = this.getKillSwitchService();
      const status = killSwitchService.getStatus();
      res.json(this.wrapResponse(status));
    });

    // Activate kill switch
    this.app.post('/api/kill-switch/activate', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { reason, reasonCategory, cancelOrders } = req.body as {
          reason?: string;
          reasonCategory?: KillSwitchReasonCategory;
          cancelOrders?: boolean;
        };

        const killSwitchService = this.getKillSwitchService();

        // Update config if cancelOrders is specified
        if (cancelOrders !== undefined) {
          killSwitchService.updateConfig({ cancelOrdersOnActivation: cancelOrders });
        }

        // Set adapter if not set
        const adapter = this.connectionService.getAdapter(this.currentBrokerType);
        if (adapter) {
          killSwitchService.setAdapter(adapter);
        }

        const result = await killSwitchService.activate(
          'user' as KillSwitchActivator,
          reason,
          reasonCategory ?? 'manual'
        );

        res.json(this.wrapResponse(result));
      } catch (error) {
        next(error);
      }
    });

    // Deactivate kill switch (re-enable system)
    this.app.post('/api/kill-switch/deactivate', async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { confirmed } = req.body as { confirmed?: boolean };

        const killSwitchService = this.getKillSwitchService();
        const result = await killSwitchService.deactivate(confirmed ?? false);

        if (!result.success) {
          res.status(400).json(this.wrapResponse(result, result.error));
          return;
        }

        res.json(this.wrapResponse(result));
      } catch (error) {
        next(error);
      }
    });

    // Update kill switch config
    this.app.put('/api/kill-switch/config', (req: Request, res: Response, next: NextFunction) => {
      try {
        const config = req.body as Partial<KillSwitchConfig>;

        const killSwitchService = this.getKillSwitchService();
        killSwitchService.updateConfig(config);

        res.json(this.wrapResponse({
          config: killSwitchService.getConfig(),
          status: killSwitchService.getStatus(),
        }));
      } catch (error) {
        next(error);
      }
    });

    // Get kill switch event history
    this.app.get('/api/kill-switch/history', (_req: Request, res: Response) => {
      const killSwitchService = this.getKillSwitchService();
      const events = killSwitchService.getEventHistory();
      res.json(this.wrapResponse({
        total: events.length,
        events,
      }));
    });

    // Check if operation is blocked
    this.app.get('/api/kill-switch/check/:operation', (req: Request, res: Response) => {
      const operation = req.params.operation as 'order_submit' | 'order_modify' | 'auto_reprice' | 'alert_action';
      const validOperations = ['order_submit', 'order_modify', 'auto_reprice', 'alert_action'];

      if (!validOperations.includes(operation)) {
        res.status(400).json(this.wrapResponse(null, `Invalid operation. Must be one of: ${validOperations.join(', ')}`));
        return;
      }

      const killSwitchService = this.getKillSwitchService();
      const status = killSwitchService.getStatus();
      const blocked = shouldBlockOperation(status, operation);
      const message = blocked ? getBlockedOperationMessage(status, operation) : '';

      res.json(this.wrapResponse({
        operation,
        blocked,
        message,
        killSwitchActive: status.state === 'active',
      }));
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
   * Get or create the alert monitoring service
   */
  private getAlertService(): AlertMonitorService | null {
    // Create alert service lazily when broker is connected
    if (!this.alertService) {
      const adapter = this.connectionService.getAdapter(this.currentBrokerType);
      if (!adapter) {
        return null;
      }

      const marketDataService = createMarketDataService(adapter);
      this.alertService = createAlertMonitorService(
        adapter,
        marketDataService,
        this.currentBrokerType,
        {
          pollingIntervalMs: 60000, // 1 minute
          maxAlerts: 100,
          maxTriggers: 50,
        },
        this.auditLogService ?? undefined
      );
    }
    return this.alertService;
  }

  /**
   * Get or create the alert action proposals service
   */
  private getAlertProposalsService(): AlertActionProposalsService | null {
    // Create alert proposals service lazily when broker is connected
    if (!this.alertProposalsService) {
      const adapter = this.connectionService.getAdapter(this.currentBrokerType);
      if (!adapter || !this.proposalService) {
        return null;
      }

      const marketDataService = createMarketDataService(adapter);
      this.alertProposalsService = createAlertActionProposalsService(
        adapter,
        marketDataService,
        this.proposalService,
        this.currentBrokerType,
        {
          defaultExitPercent: 100,
          defaultTrimPercent: 50,
          defaultTimeInForce: 'day',
          defaultOrderType: 'limit',
          slippagePercent: 1,
        },
        this.auditLogService ?? undefined
      );
    }
    return this.alertProposalsService;
  }

  /**
   * Get or create the kill switch service
   */
  private getKillSwitchService(): KillSwitchService {
    // Create kill switch service lazily
    if (!this.killSwitchService) {
      // Use broker type as account ID for simplicity
      const accountId = this.currentBrokerType;
      this.killSwitchService = createKillSwitchService(
        accountId,
        {
          logger: {
            info: (msg, data) => console.log(`[KillSwitch] ${msg}`, data),
            warn: (msg, data) => console.warn(`[KillSwitch] ${msg}`, data),
            error: (msg, data) => console.error(`[KillSwitch] ${msg}`, data),
          },
        },
        this.auditLogService ?? undefined
      );

      // Set adapter if connected
      const adapter = this.connectionService.getAdapter(this.currentBrokerType);
      if (adapter) {
        this.killSwitchService.setAdapter(adapter);
      }
    }
    return this.killSwitchService;
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
  port?: number,
  submissionStore?: OrderSubmissionStore,
  proposalService?: TradeProposalService,
  auditLogService?: AuditLogService
): ApiServer {
  return new ApiServer(connectionService, port, submissionStore, proposalService, auditLogService);
}
