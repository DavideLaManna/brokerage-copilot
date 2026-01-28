/**
 * ChatPanel Component
 *
 * Chat interface for interacting with the Options Trading Copilot agent.
 * Supports commands like "review positions", "analyze portfolio", and "show exposure".
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { PortfolioReviewResult } from './ChatPanel.types';

/**
 * Chat message structure
 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  /** Optional structured data for rich display */
  data?: {
    type: 'review' | 'exposure' | 'error';
    payload: unknown;
  };
}

/**
 * Supported chat commands
 */
type ChatCommand = 'review' | 'analyze' | 'exposure' | 'help' | 'unknown';

/**
 * Parse user input to identify command
 */
function parseCommand(input: string): ChatCommand {
  const normalized = input.toLowerCase().trim();

  // Review commands
  if (
    normalized.includes('review') ||
    normalized.includes('analyze portfolio') ||
    normalized.includes('check portfolio') ||
    normalized.includes('portfolio review')
  ) {
    return 'review';
  }

  // Exposure commands
  if (
    normalized.includes('exposure') ||
    normalized.includes('concentration') ||
    normalized.includes('show risk')
  ) {
    return 'exposure';
  }

  // Help command
  if (normalized === 'help' || normalized === '?' || normalized.includes('what can you')) {
    return 'help';
  }

  return 'unknown';
}

/**
 * Props for ChatPanel component
 */
interface ChatPanelProps {
  /** API base URL */
  apiBaseUrl?: string;
  /** Whether in demo mode */
  demoMode?: boolean;
  /** Callback when a review is generated (for potential UI updates) */
  onReviewGenerated?: (review: PortfolioReviewResult) => void;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Format markdown content for display
 * Simple markdown parsing for chat responses
 */
function formatMarkdown(content: string): React.ReactNode {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let currentList: string[] = [];
  let listKey = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${listKey++}`} className="chat-list">
          {currentList.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    if (line.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={i} className="chat-heading chat-heading--h3">
          {line.slice(4)}
        </h4>
      );
    } else if (line.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={i} className="chat-heading chat-heading--h2">
          {line.slice(3)}
        </h3>
      );
    }
    // List items
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      currentList.push(line.slice(2));
    }
    // Priority/severity tags - format inline
    else if (line.includes('[HIGH]') || line.includes('[MED]') || line.includes('[LOW]')) {
      flushList();
      const formattedLine = line
        .replace(/\[HIGH\]/g, '<span class="tag tag--high">HIGH</span>')
        .replace(/\[MED\]/g, '<span class="tag tag--med">MED</span>')
        .replace(/\[LOW\]/g, '<span class="tag tag--low">LOW</span>')
        .replace(/\[!\]/g, '<span class="severity severity--critical">!</span>')
        .replace(/\[\*\]/g, '<span class="severity severity--warning">*</span>')
        .replace(/\[-\]/g, '<span class="severity severity--info">-</span>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      elements.push(
        <p
          key={i}
          className="chat-text"
          dangerouslySetInnerHTML={{ __html: formattedLine }}
        />
      );
    }
    // Bold text
    else if (line.includes('**')) {
      flushList();
      const formattedLine = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      elements.push(
        <p key={i} className="chat-text" dangerouslySetInnerHTML={{ __html: formattedLine }} />
      );
    }
    // Empty lines
    else if (line.trim() === '') {
      flushList();
    }
    // Regular text with indentation
    else if (line.startsWith('  ')) {
      flushList();
      elements.push(
        <p key={i} className="chat-text chat-text--indented">
          {line.trim()}
        </p>
      );
    }
    // Regular text
    else {
      flushList();
      elements.push(
        <p key={i} className="chat-text">
          {line}
        </p>
      );
    }
  }

  flushList();
  return elements;
}

/**
 * Help message content
 */
const HELP_MESSAGE = `I can help you analyze and manage your options portfolio. Here are some things you can ask:

### Portfolio Analysis
- "Review my portfolio" - Get a full analysis with recommendations
- "Analyze portfolio" - Same as review
- "Check portfolio" - Quick health check

### Risk & Exposure
- "Show exposure" - View exposure by underlying
- "Check concentration" - Review position concentration
- "Show risk" - View portfolio risk metrics

### Quick Tips
- I analyze P&L, risk exposure, concentration, Greeks, and expirations
- I provide action recommendations: HOLD, TRIM, EXIT, HEDGE, MONITOR
- I do NOT execute any orders - you maintain full control

Type a command or ask a question to get started!`;

export default function ChatPanel({
  apiBaseUrl = 'http://localhost:3001',
  demoMode = false,
  onReviewGenerated,
}: ChatPanelProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: generateMessageId(),
      role: 'assistant',
      content: 'Hello! I\'m your Options Trading Copilot. Ask me to review your portfolio, show exposure, or analyze your positions. Type "help" for available commands.',
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Add a message to the chat
   */
  const addMessage = useCallback((role: 'user' | 'assistant', content: string, data?: ChatMessage['data']) => {
    const newMessage: ChatMessage = {
      id: generateMessageId(),
      role,
      content,
      timestamp: new Date(),
      data,
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  }, []);

  /**
   * Handle portfolio review command
   */
  const handleReviewCommand = useCallback(async () => {
    if (demoMode) {
      // Return mock review in demo mode
      const mockReview = `### Portfolio Health: ! CAUTION

### Summary
Portfolio requires attention. 4 positions (3 options, 1 equity). Total unrealized P&L: $1,835 up. 1 high-priority action(s) recommended.

### Positions Requiring Immediate Attention
- TSLA240301C00250000

### Analysis Findings
[*] **pnl**: 1 position(s) up more than 50%
[*] **expiration**: 1 position(s) expire within 7 days

### Recommended Actions
[HIGH] **MONITOR** TSLA240301C00250000
  Rationale: Position expires in 5 days
  Details: Plan exit or roll strategy before expiration week
[LOW] **TRIM** AAPL240216C00185000
  Rationale: Position up 36%. Consider taking profits.
  Details: Consider trimming 25-50% to lock in gains

### Data Sources
- Tradier API (retrieved: ${new Date().toISOString()})
- Review generated: ${new Date().toISOString()}`;

      return mockReview;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/chat/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to generate review');
      }

      if (onReviewGenerated && result.data?.review) {
        onReviewGenerated(result.data.review);
      }

      return result.data.formattedReview as string;
    } catch (error) {
      throw error;
    }
  }, [apiBaseUrl, demoMode, onReviewGenerated]);

  /**
   * Handle exposure command
   */
  const handleExposureCommand = useCallback(async () => {
    if (demoMode) {
      return `### Portfolio Exposure Summary

**Total Positions:** 4
**Total Risk:** $31,620 (25.2% of account)
**Concentration Limit:** 10%

### Exposure by Underlying

| Symbol | Positions | Risk | Risk % | Status |
|--------|-----------|------|--------|--------|
| NVDA | 1 | $25,625 | 20.4% | OVER LIMIT |
| AAPL | 1 | $2,900 | 2.3% | OK |
| SPY | 1 | $855 | 0.7% | OK |
| TSLA | 1 | $1,240 | 1.0% | OK |

### Warnings
- NVDA exposure (20.4%) exceeds 10% concentration limit`;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/exposure`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch exposure');
      }

      // Format exposure data for display
      const exposure = result.data;
      let formatted = `### Portfolio Exposure Summary\n\n`;
      formatted += `**Total Positions:** ${exposure.underlyingCount}\n`;
      formatted += `**Total Risk:** $${exposure.totalRisk.toLocaleString()} (${exposure.totalRiskPercent.toFixed(1)}% of account)\n`;
      formatted += `**Concentration Limit:** ${exposure.concentrationLimit}%\n\n`;
      formatted += `### Exposure by Underlying\n\n`;

      for (const u of exposure.underlyings) {
        const status = u.exceedsLimit ? '**OVER LIMIT**' : 'OK';
        formatted += `- **${u.symbol}**: ${u.positionCount} position(s), $${u.risk.toLocaleString()} risk (${u.riskPercent.toFixed(1)}%) - ${status}\n`;
      }

      if (exposure.exceedingLimitCount > 0) {
        formatted += `\n### Warnings\n`;
        for (const u of exposure.underlyings.filter((e: { exceedsLimit: boolean }) => e.exceedsLimit)) {
          formatted += `- ${u.symbol} exposure (${u.riskPercent.toFixed(1)}%) exceeds ${exposure.concentrationLimit}% concentration limit\n`;
        }
      }

      return formatted;
    } catch (error) {
      throw error;
    }
  }, [apiBaseUrl, demoMode]);

  /**
   * Process user input and generate response
   */
  const processInput = useCallback(async (input: string) => {
    const command = parseCommand(input);

    try {
      switch (command) {
        case 'review':
          const review = await handleReviewCommand();
          return review;

        case 'exposure':
          const exposure = await handleExposureCommand();
          return exposure;

        case 'help':
          return HELP_MESSAGE;

        case 'unknown':
        default:
          // Try to be helpful with unknown commands
          if (input.toLowerCase().includes('position')) {
            return 'To review your positions, try "review portfolio" or "analyze positions". I\'ll provide a detailed analysis with recommendations.';
          }
          if (input.toLowerCase().includes('greek')) {
            return 'Greeks analysis is included in the portfolio review. Try "review portfolio" to see delta, gamma, theta, and vega exposure.';
          }
          return `I'm not sure how to help with that. Try:\n- "review portfolio" - Full analysis with recommendations\n- "show exposure" - View risk by underlying\n- "help" - See all available commands`;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      return `Sorry, I encountered an error: ${errorMessage}\n\nPlease make sure the API server is running and you're connected to your broker.`;
    }
  }, [handleReviewCommand, handleExposureCommand]);

  /**
   * Handle form submission
   */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedInput = inputValue.trim();
    if (!trimmedInput || isProcessing) return;

    // Add user message
    addMessage('user', trimmedInput);
    setInputValue('');
    setIsProcessing(true);

    try {
      const response = await processInput(trimmedInput);
      addMessage('assistant', response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      addMessage('assistant', `Error: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
      inputRef.current?.focus();
    }
  }, [inputValue, isProcessing, addMessage, processInput]);

  /**
   * Handle quick action button clicks
   */
  const handleQuickAction = useCallback((action: string) => {
    setInputValue(action);
    // Auto-submit after a brief delay to show the input
    setTimeout(() => {
      const form = document.querySelector('.chat-input-form') as HTMLFormElement;
      form?.requestSubmit();
    }, 100);
  }, []);

  return (
    <div className="section chat-panel">
      <div className="section-header">
        <h2 className="section-title">Copilot Chat</h2>
        <div className="chat-actions">
          <button
            className="btn btn--small"
            onClick={() => handleQuickAction('review portfolio')}
            disabled={isProcessing}
          >
            Review
          </button>
          <button
            className="btn btn--small"
            onClick={() => handleQuickAction('show exposure')}
            disabled={isProcessing}
          >
            Exposure
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message chat-message--${message.role}`}
          >
            <div className="chat-message-header">
              <span className="chat-message-role">
                {message.role === 'user' ? 'You' : 'Copilot'}
              </span>
              <span className="chat-message-time">
                {message.timestamp.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <div className="chat-message-content">
              {message.role === 'assistant'
                ? formatMarkdown(message.content)
                : message.content}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="chat-message chat-message--assistant">
            <div className="chat-message-header">
              <span className="chat-message-role">Copilot</span>
            </div>
            <div className="chat-message-content">
              <div className="chat-typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          placeholder="Ask me to review positions, show exposure, or analyze portfolio..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isProcessing}
        />
        <button
          type="submit"
          className="btn chat-submit-btn"
          disabled={!inputValue.trim() || isProcessing}
        >
          Send
        </button>
      </form>
    </div>
  );
}
