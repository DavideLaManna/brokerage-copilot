/**
 * Services Exports
 */

export {
  BrokerConnectionService,
  createBrokerConnectionService,
  type ConnectionState,
  type ConnectionResult,
} from './broker-connection.js';

export {
  RiskConfigService,
  createRiskConfigServiceFromEnv,
  type RiskConfigServiceOptions,
} from './risk-config.js';

export {
  MarketDataService,
  createMarketDataService,
  type MarketDataServiceConfig,
  type CacheStats,
} from './market-data.js';

export {
  RiskEngine,
  createRiskEngine,
  validateOrder,
  type RiskCheckType,
  type RiskCheckResult,
  type OrderValidationResult,
  type ValidationContext,
  type RiskEngineConfig,
  type RiskEngineLogger,
} from './risk-engine.js';

export {
  calculateSpreadPercent,
  computeSpreadPercent,
  getLiquidityRating,
  getLiquidityDescription,
  computeLiquidityMetrics,
  addLiquidityToContract,
  addLiquidityToChain,
  filterByLiquidity,
  sortByLiquidity,
  getChainLiquiditySummary,
  DEFAULT_LIQUIDITY_CONFIG,
  type LiquidityRating,
  type LiquidityMetrics,
  type LiquidityScoringConfig,
  type OptionContractWithLiquidity,
  type OptionChainWithLiquidity,
} from './liquidity.js';

export {
  ExposureCalculator,
  createExposureCalculator,
  calculatePortfolioExposure,
  getExceedingLimitUnderlyings,
  formatExposureForDisplay,
  type UnderlyingExposure,
  type PositionSummary,
  type AggregatedGreeks,
  type PortfolioExposure,
  type ExposureCalculatorConfig,
} from './exposure-calculator.js';

export {
  calculatePortfolioGreeks,
  calculateDetailedPortfolioGreeks,
  formatGreekValue,
  formatPortfolioGreeksForDisplay,
  getGreeksInterpretation,
  checkGreeksRisk,
  type PortfolioGreeks,
  type GreekValue,
  type PositionGreeksBreakdown,
  type DetailedPortfolioGreeks,
} from './portfolio-greeks.js';

export {
  TradeProposalService,
  createTradeProposalServiceFromEnv,
  type TradeProposalServiceOptions,
  type ProposalQueryOptions,
} from './trade-proposal.js';

export {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateTrueRange,
  getRSIInterpretation,
  getATRInterpretation,
  analyzeTrend,
  computeTechnicalIndicators,
  filterIndicators,
  formatRSIInterpretation,
  formatATRInterpretation,
  formatTrendInterpretation,
  DEFAULT_TECHNICALS_CONFIG,
  type TechnicalIndicatorsConfig,
  type RSIResult,
  type RSIInterpretation,
  type MovingAverageResult,
  type ATRResult,
  type ATRInterpretation,
  type TrendAnalysis,
  type TechnicalAnalysis,
  type ComputeTechnicalsInput,
  type IndicatorType,
} from './technical-indicators.js';

export {
  buildDraftOrder,
  buildDraftOrders,
  buildDraftOrdersFromStored,
  buildDraftOrderFromContract,
  generateIdempotencyKey,
  generateCorrelationId,
  validateDraftOrder,
  validateDraftOrdersResult,
  formatDraftOrder,
  formatDraftOrdersResult,
  DEFAULT_DRAFT_ORDER_CONFIG,
  type DraftOrder,
  type BuildDraftOrdersResult,
  type DraftOrderBuilderConfig,
} from './draft-order-builder.js';

export {
  OrderSubmissionService,
  createOrderSubmissionService,
  submitOrder,
  submitOrders,
  DEFAULT_SUBMISSION_CONFIG,
  type OrderSubmissionResult,
  type BatchSubmissionResult,
  type OrderSubmissionServiceConfig,
  type OrderSubmissionLogger,
} from './order-submission.js';

export {
  AuditLogService,
  createAuditLogServiceFromEnv,
  createAuditLogger,
  type AuditLogServiceOptions,
  type AuditLogServiceLogger,
} from './audit-log.js';

export {
  OrderRepricingService,
  createOrderRepricingService,
  evaluateOrderForRepricing,
  type OrderRepricingServiceConfig,
  type RepricingServiceLogger,
} from './order-repricing.js';

export {
  proposeExitLadder,
  proposeExitLadderPreset,
  proposeExitLadderFromTargets,
  calculateExitPrice,
  calculateContractsToClose,
  validateRungPercentages,
  validateExitLadderConfig,
  formatExitLadderOrder,
  formatExitLadderProposal,
  toBuiltDraftOrdersResult,
  PRESET_LADDERS,
  DEFAULT_EXIT_LADDER_CONFIG,
  ExitLadderRungSchema,
  ExitLadderConfigSchema,
  type ExitLadderRung,
  type ExitLadderConfig,
  type ExitLadderOrder,
  type ExitLadderProposal,
  type ExitLadderValidationContext,
} from './exit-ladder-builder.js';

export {
  AlertMonitorService,
  createAlertMonitorService,
  evaluateAlertTrigger,
  type AlertMonitorConfig,
  type AlertServiceLogger,
  type AlertScanResult,
} from './alert-monitor.js';

export {
  AlertActionProposalsService,
  createAlertActionProposalsService,
  generateAlertProposal,
  type AlertActionProposalsConfig,
  type AlertProposalResult,
  type AlertWithProposals,
  type GenerateProposalOptions,
} from './alert-action-proposals.js';

export {
  KillSwitchService,
  createKillSwitchService,
  shouldBlockOperation,
  getBlockedOperationMessage,
  type KillSwitchServiceConfig,
  type KillSwitchServiceLogger,
  type KillSwitchCallback,
} from './kill-switch.js';

export {
  SpreadCalculator,
  createSpreadCalculator,
  createSpreadFromProposal,
  calculateSpreadRiskMetrics,
  calculateVerticalSpreadRisk,
  calculateIronCondorRisk,
  calculateStraddleStrangleRisk,
  calculateCalendarSpreadRisk,
  calculateSingleLegRisk,
  calculateSpreadWidth,
  calculateNetPremium,
  validateSpread as validateSpreadProposal,
  type SpreadCalculationContext,
  type SpreadValidationResult as SpreadCalcValidationResult,
} from './spread-calculator.js';

// Re-export spread validation from risk-engine
export {
  validateSpread,
  type SpreadValidationResult,
} from './risk-engine.js';

// Research pipeline
export {
  WebScraper,
  createWebScraper,
  scrapeUrl,
  type WebScraperLogger,
} from './web-scraper.js';

export {
  ArticleSummarizer,
  MockLLMProvider,
  createMockArticleSummarizer,
  createArticleSummarizer,
  summarizeArticle,
  type LLMProvider,
  type LLMCompletionOptions,
  type LLMCompletionResult,
  type ArticleSummarizerLogger,
} from './article-summarizer.js';

export {
  ResearchStorageService,
  createResearchStorageService,
  type ResearchStorageOptions,
  type ResearchStorageLogger,
} from './research-storage.js';

export {
  ResearchIngestionService,
  createResearchIngestionService,
  type ResearchIngestionConfig,
  type ResearchIngestionServiceOptions,
  type ResearchIngestionLogger,
} from './research-ingestion.js';

// PDF Filing Pipeline
export {
  PDFExtractor,
  MockPDFExtractor,
  createPDFExtractor,
  createMockPDFExtractor,
  extractPDFFromUrl,
  extractPDFFromBuffer,
  MockPDFParser,
  type PDFExtractorLogger,
  type PDFParser,
} from './pdf-extractor.js';

export {
  DocumentChunker,
  createDocumentChunker,
  chunkPDFContent,
  chunkFilingSection,
  chunkText,
  estimateChunkCount,
  type ChunkerLogger,
  type ChunkingOptions,
} from './document-chunker.js';

export {
  FilingSummarizer,
  createFilingSummarizer,
  summarizeFilingSection,
  generateFilingSummary,
  MockFilingLLMProvider,
  type FilingSummarizerLogger,
  type SummarizationOptions,
} from './filing-summarizer.js';

export {
  FactExtractor,
  createFactExtractor,
  extractFactsFromSection,
  extractFactsFromContent,
  MockFactExtractionLLMProvider,
  DEFAULT_FACT_EXTRACTOR_CONFIG,
  type FactExtractorLogger,
  type FactExtractorConfig,
  type ExtractionOptions,
} from './fact-extractor.js';

export {
  PDFIngestionService,
  createPDFIngestionService,
  ingestPDFFiling,
  ingestPDFFilingsBatch,
  MockResearchNoteStorage,
  DEFAULT_PDF_INGESTION_CONFIG,
  type PDFIngestionLogger,
  type PDFIngestionConfig,
  type ResearchNoteStorage,
} from './pdf-ingestion.js';
