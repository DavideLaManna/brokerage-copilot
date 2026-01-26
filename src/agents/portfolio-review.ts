/**
 * Portfolio Review Agent
 *
 * LLM agent prompt template for portfolio review and analysis.
 * Analyzes portfolio snapshot and returns recommended actions with rationale.
 *
 * This agent does NOT execute orders - it only provides recommendations.
 */

import type { PortfolioSnapshot, SnapshotPosition, SnapshotExposure } from '../tools/types.js';

// ============================================================================
// Types
// ============================================================================

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
  /** Type of action */
  action: ActionType;
  /** Priority level */
  priority: ActionPriority;
  /** Symbol or underlying this action relates to */
  symbol: string;
  /** Position ID if applicable */
  positionId?: string;
  /** Human-readable rationale */
  rationale: string;
  /** Analysis categories that triggered this recommendation */
  triggeredBy: AnalysisCategory[];
  /** Suggested action details (e.g., "Reduce position by 50%") */
  details?: string;
}

/**
 * Analysis finding from portfolio review
 */
export interface AnalysisFinding {
  /** Category of analysis */
  category: AnalysisCategory;
  /** Severity level */
  severity: 'info' | 'warning' | 'critical';
  /** Finding description */
  description: string;
  /** Related symbol(s) */
  symbols?: string[];
  /** Quantitative details */
  details?: Record<string, unknown>;
}

/**
 * Complete portfolio review result
 */
export interface PortfolioReviewResult {
  /** Overall portfolio health assessment */
  healthAssessment: 'healthy' | 'caution' | 'at_risk';
  /** Summary of the review */
  summary: string;
  /** Analysis findings */
  findings: AnalysisFinding[];
  /** Recommended actions */
  actions: RecommendedAction[];
  /** Positions that need immediate attention */
  attentionRequired: string[];
  /** Data timestamp from snapshot */
  dataTimestamp: string;
  /** Data sources used */
  dataSources: { source: string; retrievedAt: string }[];
  /** When the review was generated */
  reviewGeneratedAt: string;
}

/**
 * Configuration for portfolio review
 */
export interface PortfolioReviewConfig {
  /** Threshold for P&L loss to flag (negative percentage) */
  pnlLossThreshold: number;
  /** Threshold for P&L gain to consider trimming (positive percentage) */
  pnlGainThreshold: number;
  /** Days to expiration threshold for near-expiration warning */
  nearExpirationDays: number;
  /** Concentration limit percentage */
  concentrationLimit: number;
  /** Maximum delta exposure before warning */
  maxDeltaExposure: number;
  /** Maximum daily theta decay (absolute value) */
  maxThetaDecay: number;
  /** Minimum profit target percentage reached to suggest trimming */
  trimProfitPercent: number;
}

/**
 * Default configuration for portfolio review
 */
export const DEFAULT_REVIEW_CONFIG: PortfolioReviewConfig = {
  pnlLossThreshold: -50, // Flag positions down 50%+
  pnlGainThreshold: 50, // Consider trimming positions up 50%+
  nearExpirationDays: 7, // Warn about positions expiring within 7 days
  concentrationLimit: 10, // 10% concentration limit
  maxDeltaExposure: 500, // Warn if delta > 500 shares equivalent
  maxThetaDecay: 100, // Warn if losing > $100/day to theta
  trimProfitPercent: 50, // Suggest trim at 50%+ profit
};

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Analyze P&L across positions
 */
export function analyzePnL(
  snapshot: PortfolioSnapshot,
  config: PortfolioReviewConfig
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  // Check overall P&L
  const totalPnLPercent =
    snapshot.summary.totalMarketValue > 0
      ? (snapshot.summary.totalUnrealizedPnL / snapshot.summary.totalMarketValue) * 100
      : 0;

  if (totalPnLPercent < -20) {
    findings.push({
      category: 'pnl',
      severity: 'critical',
      description: `Portfolio is down ${Math.abs(totalPnLPercent).toFixed(1)}% overall`,
      details: {
        totalPnL: snapshot.summary.totalUnrealizedPnL,
        totalPnLPercent,
      },
    });
  } else if (totalPnLPercent < -10) {
    findings.push({
      category: 'pnl',
      severity: 'warning',
      description: `Portfolio is down ${Math.abs(totalPnLPercent).toFixed(1)}% overall`,
      details: {
        totalPnL: snapshot.summary.totalUnrealizedPnL,
        totalPnLPercent,
      },
    });
  }

  // Check individual positions with significant losses
  const losingPositions = snapshot.positions.filter(
    (p) => p.unrealizedPnLPercent < config.pnlLossThreshold
  );

  if (losingPositions.length > 0) {
    findings.push({
      category: 'pnl',
      severity: 'warning',
      description: `${losingPositions.length} position(s) down more than ${Math.abs(config.pnlLossThreshold)}%`,
      symbols: losingPositions.map((p) => p.symbol),
      details: {
        positions: losingPositions.map((p) => ({
          symbol: p.symbol,
          pnl: p.unrealizedPnL,
          pnlPercent: p.unrealizedPnLPercent,
        })),
      },
    });
  }

  // Check individual positions with significant gains (opportunity to trim)
  const winningPositions = snapshot.positions.filter(
    (p) => p.unrealizedPnLPercent > config.pnlGainThreshold
  );

  if (winningPositions.length > 0) {
    findings.push({
      category: 'pnl',
      severity: 'info',
      description: `${winningPositions.length} position(s) up more than ${config.pnlGainThreshold}%`,
      symbols: winningPositions.map((p) => p.symbol),
      details: {
        positions: winningPositions.map((p) => ({
          symbol: p.symbol,
          pnl: p.unrealizedPnL,
          pnlPercent: p.unrealizedPnLPercent,
        })),
      },
    });
  }

  return findings;
}

/**
 * Analyze risk exposure
 */
export function analyzeRiskExposure(
  snapshot: PortfolioSnapshot,
  config: PortfolioReviewConfig
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  // Check total risk as percentage of account
  if (snapshot.summary.totalRiskPercent > 50) {
    findings.push({
      category: 'risk_exposure',
      severity: 'critical',
      description: `Total portfolio risk is ${snapshot.summary.totalRiskPercent.toFixed(1)}% of account value`,
      details: {
        totalRisk: snapshot.summary.totalRisk,
        totalRiskPercent: snapshot.summary.totalRiskPercent,
        accountValue: snapshot.account.netLiquidation,
      },
    });
  } else if (snapshot.summary.totalRiskPercent > 30) {
    findings.push({
      category: 'risk_exposure',
      severity: 'warning',
      description: `Total portfolio risk is ${snapshot.summary.totalRiskPercent.toFixed(1)}% of account value`,
      details: {
        totalRisk: snapshot.summary.totalRisk,
        totalRiskPercent: snapshot.summary.totalRiskPercent,
      },
    });
  }

  // Check buying power utilization
  const buyingPowerPercent =
    (snapshot.account.buyingPower / snapshot.account.netLiquidation) * 100;

  if (buyingPowerPercent < 20) {
    findings.push({
      category: 'risk_exposure',
      severity: 'warning',
      description: `Low buying power: only ${buyingPowerPercent.toFixed(1)}% available`,
      details: {
        buyingPower: snapshot.account.buyingPower,
        buyingPowerPercent,
      },
    });
  }

  return findings;
}

/**
 * Analyze concentration by underlying
 */
export function analyzeConcentration(
  snapshot: PortfolioSnapshot,
  config: PortfolioReviewConfig
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  // Check for underlyings exceeding concentration limit
  const overConcentrated = snapshot.exposureByUnderlying.filter((e) => e.exceedsLimit);

  if (overConcentrated.length > 0) {
    findings.push({
      category: 'concentration',
      severity: 'critical',
      description: `${overConcentrated.length} underlying(s) exceed concentration limit`,
      symbols: overConcentrated.map((e) => e.symbol),
      details: {
        underlyings: overConcentrated.map((e) => ({
          symbol: e.symbol,
          riskPercent: e.riskPercent,
          limit: config.concentrationLimit,
        })),
      },
    });
  }

  // Warn about high concentration even if not exceeding limit
  const highConcentration = snapshot.exposureByUnderlying.filter(
    (e) => !e.exceedsLimit && e.riskPercent > config.concentrationLimit * 0.7
  );

  if (highConcentration.length > 0) {
    findings.push({
      category: 'concentration',
      severity: 'warning',
      description: `${highConcentration.length} underlying(s) approaching concentration limit`,
      symbols: highConcentration.map((e) => e.symbol),
      details: {
        underlyings: highConcentration.map((e) => ({
          symbol: e.symbol,
          riskPercent: e.riskPercent,
          limit: config.concentrationLimit,
        })),
      },
    });
  }

  return findings;
}

/**
 * Analyze portfolio Greeks
 */
export function analyzeGreeks(
  snapshot: PortfolioSnapshot,
  config: PortfolioReviewConfig
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const greeks = snapshot.portfolioGreeks;

  // Check delta exposure
  if (Math.abs(greeks.delta) > config.maxDeltaExposure) {
    const direction = greeks.delta > 0 ? 'long' : 'short';
    findings.push({
      category: 'greeks',
      severity: 'warning',
      description: `High delta exposure: ${direction} ${Math.abs(greeks.delta).toFixed(0)} delta-equivalent shares`,
      details: {
        delta: greeks.delta,
        maxDelta: config.maxDeltaExposure,
      },
    });
  }

  // Check theta decay
  if (Math.abs(greeks.theta) > config.maxThetaDecay) {
    const impact = greeks.theta < 0 ? 'losing' : 'gaining';
    findings.push({
      category: 'greeks',
      severity: greeks.theta < 0 ? 'warning' : 'info',
      description: `High theta: ${impact} $${Math.abs(greeks.theta).toFixed(0)} per day from time decay`,
      details: {
        theta: greeks.theta,
        maxTheta: config.maxThetaDecay,
      },
    });
  }

  // Check for positions missing Greeks
  if (greeks.positionsWithoutGreeks > 0) {
    findings.push({
      category: 'greeks',
      severity: 'info',
      description: `${greeks.positionsWithoutGreeks} position(s) missing Greeks data`,
      details: {
        positionsWithGreeks: greeks.positionsWithGreeks,
        positionsWithoutGreeks: greeks.positionsWithoutGreeks,
      },
    });
  }

  return findings;
}

/**
 * Analyze upcoming expirations
 */
export function analyzeExpirations(
  snapshot: PortfolioSnapshot,
  config: PortfolioReviewConfig
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  // Find positions expiring soon
  const nearExpiration = snapshot.positions.filter(
    (p) =>
      p.optionDetails &&
      p.optionDetails.daysToExpiration <= config.nearExpirationDays
  );

  if (nearExpiration.length > 0) {
    const expiringToday = nearExpiration.filter(
      (p) => p.optionDetails!.daysToExpiration === 0
    );
    const expiringThisWeek = nearExpiration.filter(
      (p) => p.optionDetails!.daysToExpiration > 0
    );

    if (expiringToday.length > 0) {
      findings.push({
        category: 'expiration',
        severity: 'critical',
        description: `${expiringToday.length} position(s) expire TODAY`,
        symbols: expiringToday.map((p) => p.symbol),
        details: {
          positions: expiringToday.map((p) => ({
            symbol: p.symbol,
            dte: 0,
            pnl: p.unrealizedPnL,
          })),
        },
      });
    }

    if (expiringThisWeek.length > 0) {
      findings.push({
        category: 'expiration',
        severity: 'warning',
        description: `${expiringThisWeek.length} position(s) expire within ${config.nearExpirationDays} days`,
        symbols: expiringThisWeek.map((p) => p.symbol),
        details: {
          positions: expiringThisWeek.map((p) => ({
            symbol: p.symbol,
            dte: p.optionDetails!.daysToExpiration,
            expiration: p.optionDetails!.expiration,
            pnl: p.unrealizedPnL,
          })),
        },
      });
    }
  }

  return findings;
}

/**
 * Generate recommended actions based on findings
 */
export function generateActions(
  snapshot: PortfolioSnapshot,
  findings: AnalysisFinding[],
  config: PortfolioReviewConfig
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const processedPositions = new Set<string>();

  // Process each finding and generate appropriate actions
  for (const finding of findings) {
    // Handle expiring positions
    if (finding.category === 'expiration' && finding.severity === 'critical') {
      for (const symbol of finding.symbols || []) {
        if (!processedPositions.has(symbol)) {
          const position = snapshot.positions.find((p) => p.symbol === symbol);
          actions.push({
            action: 'exit',
            priority: 'high',
            symbol,
            positionId: position?.id,
            rationale: 'Position expires today. Decide whether to close, roll, or let expire.',
            triggeredBy: ['expiration'],
            details: 'Close position before expiration or allow exercise/assignment',
          });
          processedPositions.add(symbol);
        }
      }
    }

    // Handle over-concentration
    if (finding.category === 'concentration' && finding.severity === 'critical') {
      for (const symbol of finding.symbols || []) {
        if (!processedPositions.has(`conc_${symbol}`)) {
          const exposure = snapshot.exposureByUnderlying.find((e) => e.symbol === symbol);
          actions.push({
            action: 'trim',
            priority: 'high',
            symbol,
            rationale: `Position exceeds concentration limit (${exposure?.riskPercent.toFixed(1)}% vs ${config.concentrationLimit}% limit)`,
            triggeredBy: ['concentration'],
            details: `Reduce exposure to ${symbol} to bring within concentration limits`,
          });
          processedPositions.add(`conc_${symbol}`);
        }
      }
    }

    // Handle significant losses
    if (finding.category === 'pnl' && finding.symbols) {
      const positionDetails = (finding.details?.positions as Array<{
        symbol: string;
        pnl: number;
        pnlPercent: number;
      }>) || [];

      for (const posDetail of positionDetails) {
        if (posDetail.pnlPercent < config.pnlLossThreshold) {
          const position = snapshot.positions.find((p) => p.symbol === posDetail.symbol);
          if (position && !processedPositions.has(`loss_${position.symbol}`)) {
            // Consider DTE for options
            if (position.optionDetails) {
              if (position.optionDetails.daysToExpiration < 14) {
                actions.push({
                  action: 'exit',
                  priority: 'medium',
                  symbol: position.symbol,
                  positionId: position.id,
                  rationale: `Position down ${Math.abs(posDetail.pnlPercent).toFixed(0)}% with only ${position.optionDetails.daysToExpiration} DTE remaining`,
                  triggeredBy: ['pnl', 'expiration'],
                  details: 'Consider closing to salvage remaining value',
                });
              } else {
                actions.push({
                  action: 'monitor',
                  priority: 'medium',
                  symbol: position.symbol,
                  positionId: position.id,
                  rationale: `Position down ${Math.abs(posDetail.pnlPercent).toFixed(0)}%`,
                  triggeredBy: ['pnl'],
                  details: 'Monitor closely and consider exit if thesis no longer valid',
                });
              }
            } else {
              actions.push({
                action: 'monitor',
                priority: 'medium',
                symbol: position.symbol,
                positionId: position.id,
                rationale: `Equity position down ${Math.abs(posDetail.pnlPercent).toFixed(0)}%`,
                triggeredBy: ['pnl'],
                details: 'Review investment thesis',
              });
            }
            processedPositions.add(`loss_${position.symbol}`);
          }
        }
      }
    }

    // Handle significant gains - opportunity to trim
    if (finding.category === 'pnl' && finding.severity === 'info' && finding.symbols) {
      const positionDetails = (finding.details?.positions as Array<{
        symbol: string;
        pnl: number;
        pnlPercent: number;
      }>) || [];

      for (const posDetail of positionDetails) {
        if (posDetail.pnlPercent > config.trimProfitPercent) {
          const position = snapshot.positions.find((p) => p.symbol === posDetail.symbol);
          if (position && !processedPositions.has(`profit_${position.symbol}`)) {
            actions.push({
              action: 'trim',
              priority: 'low',
              symbol: position.symbol,
              positionId: position.id,
              rationale: `Position up ${posDetail.pnlPercent.toFixed(0)}%. Consider taking profits.`,
              triggeredBy: ['pnl'],
              details: 'Consider trimming 25-50% to lock in gains',
            });
            processedPositions.add(`profit_${position.symbol}`);
          }
        }
      }
    }

    // Handle high delta exposure
    if (finding.category === 'greeks' && finding.description.includes('delta')) {
      if (!processedPositions.has('hedge_delta')) {
        const isLong = snapshot.portfolioGreeks.delta > 0;
        actions.push({
          action: 'hedge',
          priority: 'medium',
          symbol: 'PORTFOLIO',
          rationale: `Portfolio has high ${isLong ? 'long' : 'short'} delta exposure (${Math.abs(snapshot.portfolioGreeks.delta).toFixed(0)} delta)`,
          triggeredBy: ['greeks'],
          details: isLong
            ? 'Consider protective puts or reducing long exposure'
            : 'Consider covered calls or reducing short exposure',
        });
        processedPositions.add('hedge_delta');
      }
    }

    // Handle near-expiration positions that aren't expiring today
    if (finding.category === 'expiration' && finding.severity === 'warning') {
      for (const symbol of finding.symbols || []) {
        if (!processedPositions.has(symbol)) {
          const position = snapshot.positions.find((p) => p.symbol === symbol);
          if (position) {
            actions.push({
              action: 'monitor',
              priority: 'medium',
              symbol,
              positionId: position.id,
              rationale: `Position expires in ${position.optionDetails?.daysToExpiration} days`,
              triggeredBy: ['expiration'],
              details: 'Plan exit or roll strategy before expiration week',
            });
            processedPositions.add(symbol);
          }
        }
      }
    }
  }

  // Sort actions by priority
  const priorityOrder: Record<ActionPriority, number> = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Add hold recommendations for positions without issues
  const positionsWithActions = new Set(
    actions.map((a) => a.positionId).filter((id): id is string => id !== undefined)
  );

  for (const position of snapshot.positions) {
    if (!positionsWithActions.has(position.id)) {
      // Check if this position has no concerning findings
      const hasIssue = actions.some((a) => a.symbol === position.symbol);
      if (!hasIssue) {
        actions.push({
          action: 'hold',
          priority: 'low',
          symbol: position.symbol,
          positionId: position.id,
          rationale: 'Position performing within normal parameters',
          triggeredBy: [],
        });
      }
    }
  }

  return actions;
}

/**
 * Determine overall health assessment
 */
function assessHealth(findings: AnalysisFinding[]): 'healthy' | 'caution' | 'at_risk' {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  if (criticalCount > 0) {
    return 'at_risk';
  }
  if (warningCount >= 2) {
    return 'caution';
  }
  return 'healthy';
}

/**
 * Generate a summary of the review
 */
function generateSummary(
  snapshot: PortfolioSnapshot,
  findings: AnalysisFinding[],
  actions: RecommendedAction[],
  health: 'healthy' | 'caution' | 'at_risk'
): string {
  const parts: string[] = [];

  // Health status
  if (health === 'healthy') {
    parts.push('Portfolio is in good health.');
  } else if (health === 'caution') {
    parts.push('Portfolio requires attention.');
  } else {
    parts.push('Portfolio is at elevated risk.');
  }

  // Position count
  parts.push(
    `${snapshot.summary.totalPositions} positions (${snapshot.summary.optionPositions} options, ${snapshot.summary.equityPositions} equity).`
  );

  // P&L summary
  const pnlDirection = snapshot.summary.totalUnrealizedPnL >= 0 ? 'up' : 'down';
  parts.push(
    `Total unrealized P&L: $${Math.abs(snapshot.summary.totalUnrealizedPnL).toFixed(0)} ${pnlDirection}.`
  );

  // Critical findings
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  if (criticalCount > 0) {
    parts.push(`${criticalCount} critical issue(s) require immediate attention.`);
  }

  // High priority actions
  const highPriorityActions = actions.filter((a) => a.priority === 'high');
  if (highPriorityActions.length > 0) {
    parts.push(`${highPriorityActions.length} high-priority action(s) recommended.`);
  }

  return parts.join(' ');
}

// ============================================================================
// Main Review Function
// ============================================================================

/**
 * Review a portfolio snapshot and generate analysis with recommendations
 *
 * @param snapshot - Portfolio snapshot from get_portfolio_snapshot tool
 * @param config - Optional configuration overrides
 * @returns Portfolio review result with findings and actions
 */
export function reviewPortfolio(
  snapshot: PortfolioSnapshot,
  config: Partial<PortfolioReviewConfig> = {}
): PortfolioReviewResult {
  const reviewConfig: PortfolioReviewConfig = { ...DEFAULT_REVIEW_CONFIG, ...config };
  const reviewGeneratedAt = new Date().toISOString();

  // Run all analyses
  const findings: AnalysisFinding[] = [
    ...analyzePnL(snapshot, reviewConfig),
    ...analyzeRiskExposure(snapshot, reviewConfig),
    ...analyzeConcentration(snapshot, reviewConfig),
    ...analyzeGreeks(snapshot, reviewConfig),
    ...analyzeExpirations(snapshot, reviewConfig),
  ];

  // Generate actions based on findings
  const actions = generateActions(snapshot, findings, reviewConfig);

  // Assess overall health
  const healthAssessment = assessHealth(findings);

  // Generate summary
  const summary = generateSummary(snapshot, findings, actions, healthAssessment);

  // Identify positions needing immediate attention
  const attentionRequired = actions
    .filter((a) => a.priority === 'high')
    .map((a) => a.symbol);

  return {
    healthAssessment,
    summary,
    findings,
    actions,
    attentionRequired,
    dataTimestamp: snapshot.dataTimestamp,
    dataSources: snapshot.dataSources,
    reviewGeneratedAt,
  };
}

// ============================================================================
// LLM Prompt Template
// ============================================================================

/**
 * Generate a prompt for LLM to review portfolio
 *
 * This template provides context and instructions for LLM-based portfolio review.
 */
export const PORTFOLIO_REVIEW_PROMPT_TEMPLATE = `You are an options trading copilot assistant. Your role is to analyze the user's portfolio and provide actionable recommendations.

## Context
You have access to the following tools:
- get_portfolio_snapshot(): Retrieves current portfolio state including positions, orders, Greeks, and exposure

## Instructions

1. First, call get_portfolio_snapshot() to retrieve the current portfolio state.

2. Analyze the portfolio snapshot, focusing on:
   - **P&L Analysis**: Identify winning and losing positions. Flag significant unrealized losses (>50%) and gains (>50%).
   - **Risk Exposure**: Check total portfolio risk as percentage of account. Flag if >30% of account is at risk.
   - **Concentration**: Identify any underlying with >10% of portfolio risk. Over-concentration increases blowup risk.
   - **Greeks Analysis**: Review portfolio delta (directional exposure), theta (time decay), and vega (volatility sensitivity).
   - **Expiration Management**: Flag positions expiring within 7 days. These need immediate attention.

3. For each position, recommend one of these actions:
   - **HOLD**: Position is performing as expected, no action needed
   - **TRIM**: Take partial profits or reduce exposure (for positions up >50% or over-concentrated)
   - **EXIT**: Close the position entirely (for positions expiring today, severe losses, or broken thesis)
   - **HEDGE**: Add protection (for high directional exposure)
   - **MONITOR**: Watch closely but no immediate action needed

4. Provide clear rationale for each recommendation, including:
   - What triggered the recommendation
   - Specific numbers (P&L %, DTE, concentration %, etc.)
   - Suggested action details when applicable

5. IMPORTANT: You do NOT execute orders. You only provide analysis and recommendations. The user must approve and execute any trades.

## Output Format

Structure your response as:

### Portfolio Health: [HEALTHY / CAUTION / AT RISK]

### Summary
[2-3 sentences summarizing portfolio state]

### Positions Requiring Attention
[List symbols needing immediate action with priority]

### Detailed Analysis

#### P&L Analysis
[Your P&L findings]

#### Risk & Concentration
[Your risk/concentration findings]

#### Greeks Analysis
[Your Greeks findings]

#### Expiration Calendar
[Upcoming expirations]

### Recommended Actions
[Action list with rationale for each position]

### Data Sources
[List data sources and timestamps]

---

Remember: Provide objective analysis. Do not execute any orders.`;

/**
 * Format a portfolio review result for display
 */
export function formatReviewForDisplay(review: PortfolioReviewResult): string {
  const lines: string[] = [];

  // Health assessment
  const healthEmoji =
    review.healthAssessment === 'healthy'
      ? '✓'
      : review.healthAssessment === 'caution'
        ? '!'
        : '⚠';
  lines.push(`### Portfolio Health: ${healthEmoji} ${review.healthAssessment.toUpperCase()}`);
  lines.push('');

  // Summary
  lines.push('### Summary');
  lines.push(review.summary);
  lines.push('');

  // Attention required
  if (review.attentionRequired.length > 0) {
    lines.push('### Positions Requiring Immediate Attention');
    for (const symbol of review.attentionRequired) {
      lines.push(`- ${symbol}`);
    }
    lines.push('');
  }

  // Findings
  if (review.findings.length > 0) {
    lines.push('### Analysis Findings');
    for (const finding of review.findings) {
      const severityIcon =
        finding.severity === 'critical' ? '[!]' : finding.severity === 'warning' ? '[*]' : '[-]';
      lines.push(`${severityIcon} **${finding.category}**: ${finding.description}`);
    }
    lines.push('');
  }

  // Actions
  lines.push('### Recommended Actions');
  for (const action of review.actions) {
    if (action.action === 'hold' && action.priority === 'low') {
      continue; // Skip low-priority holds for brevity
    }
    const priorityTag =
      action.priority === 'high' ? '[HIGH]' : action.priority === 'medium' ? '[MED]' : '[LOW]';
    lines.push(`${priorityTag} **${action.action.toUpperCase()}** ${action.symbol}`);
    lines.push(`  Rationale: ${action.rationale}`);
    if (action.details) {
      lines.push(`  Details: ${action.details}`);
    }
  }
  lines.push('');

  // Data sources
  lines.push('### Data Sources');
  for (const source of review.dataSources) {
    lines.push(`- ${source.source} (retrieved: ${source.retrievedAt})`);
  }
  lines.push(`- Review generated: ${review.reviewGeneratedAt}`);

  return lines.join('\n');
}
