/**
 * Types for ChatPanel component
 *
 * Mirrors the backend types for portfolio review results.
 */

/**
 * Recommended action type
 */
export type ActionType = 'hold' | 'trim' | 'exit' | 'hedge' | 'monitor';

/**
 * Priority level for actions
 */
export type ActionPriority = 'high' | 'medium' | 'low';

/**
 * Analysis category
 */
export type AnalysisCategory =
  | 'pnl'
  | 'risk_exposure'
  | 'concentration'
  | 'greeks'
  | 'expiration'
  | 'liquidity';

/**
 * Single recommended action
 */
export interface RecommendedAction {
  action: ActionType;
  priority: ActionPriority;
  symbol: string;
  positionId?: string;
  rationale: string;
  triggeredBy: AnalysisCategory[];
  details?: string;
}

/**
 * Analysis finding from portfolio review
 */
export interface AnalysisFinding {
  category: AnalysisCategory;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  symbols?: string[];
  details?: Record<string, unknown>;
}

/**
 * Complete portfolio review result
 */
export interface PortfolioReviewResult {
  healthAssessment: 'healthy' | 'caution' | 'at_risk';
  summary: string;
  findings: AnalysisFinding[];
  actions: RecommendedAction[];
  attentionRequired: string[];
  dataTimestamp: string;
  dataSources: { source: string; retrievedAt: string }[];
  reviewGeneratedAt: string;
}
