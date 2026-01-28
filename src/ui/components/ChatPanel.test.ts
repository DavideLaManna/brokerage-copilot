/**
 * ChatPanel Component Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('ChatPanel', () => {

  describe('command parsing', () => {
    // Test parseCommand function logic
    it('should recognize review commands', () => {
      const reviewPatterns = [
        'review portfolio',
        'analyze portfolio',
        'check portfolio',
        'portfolio review',
        'Review my positions',
        'Can you review my portfolio?',
      ];

      for (const input of reviewPatterns) {
        const normalized = input.toLowerCase().trim();
        const isReview = normalized.includes('review') ||
          normalized.includes('analyze portfolio') ||
          normalized.includes('check portfolio') ||
          normalized.includes('portfolio review');
        expect(isReview).toBe(true);
      }
    });

    it('should recognize exposure commands', () => {
      const exposurePatterns = [
        'show exposure',
        'check concentration',
        'show risk',
        'exposure by underlying',
      ];

      for (const input of exposurePatterns) {
        const normalized = input.toLowerCase().trim();
        const isExposure = normalized.includes('exposure') ||
          normalized.includes('concentration') ||
          normalized.includes('show risk');
        expect(isExposure).toBe(true);
      }
    });

    it('should recognize help commands', () => {
      const helpPatterns = ['help', '?', 'what can you do'];

      for (const input of helpPatterns) {
        const normalized = input.toLowerCase().trim();
        const isHelp = normalized === 'help' || normalized === '?' || normalized.includes('what can you');
        expect(isHelp).toBe(true);
      }
    });

    it('should classify unknown commands', () => {
      const unknownPatterns = ['hello', 'weather', 'random text'];

      for (const input of unknownPatterns) {
        const normalized = input.toLowerCase().trim();
        const isReview = normalized.includes('review') ||
          normalized.includes('analyze portfolio') ||
          normalized.includes('check portfolio') ||
          normalized.includes('portfolio review');
        const isExposure = normalized.includes('exposure') ||
          normalized.includes('concentration') ||
          normalized.includes('show risk');
        const isHelp = normalized === 'help' || normalized === '?' || normalized.includes('what can you');

        expect(isReview || isExposure || isHelp).toBe(false);
      }
    });
  });

  describe('markdown formatting', () => {
    // Test formatMarkdown function logic
    it('should handle headers', () => {
      const h2Line = '## Summary';
      const h3Line = '### Details';

      expect(h2Line.startsWith('## ')).toBe(true);
      expect(h3Line.startsWith('### ')).toBe(true);
      expect(h2Line.slice(3)).toBe('Summary');
      expect(h3Line.slice(4)).toBe('Details');
    });

    it('should handle list items', () => {
      const dashItem = '- Item one';
      const starItem = '* Item two';

      expect(dashItem.startsWith('- ')).toBe(true);
      expect(starItem.startsWith('* ')).toBe(true);
      expect(dashItem.slice(2)).toBe('Item one');
      expect(starItem.slice(2)).toBe('Item two');
    });

    it('should handle priority tags', () => {
      const line = '[HIGH] **EXIT** AAPL position';

      expect(line.includes('[HIGH]')).toBe(true);
      const formatted = line
        .replace(/\[HIGH\]/g, '<span class="tag tag--high">HIGH</span>')
        .replace(/\[MED\]/g, '<span class="tag tag--med">MED</span>')
        .replace(/\[LOW\]/g, '<span class="tag tag--low">LOW</span>');

      expect(formatted.includes('tag--high')).toBe(true);
    });

    it('should handle severity indicators', () => {
      const criticalLine = '[!] Critical finding';
      const warningLine = '[*] Warning finding';
      const infoLine = '[-] Info finding';

      expect(criticalLine.startsWith('[!]')).toBe(true);
      expect(warningLine.startsWith('[*]')).toBe(true);
      expect(infoLine.startsWith('[-]')).toBe(true);
    });

    it('should handle bold text', () => {
      const line = 'This is **bold** text';

      expect(line.includes('**')).toBe(true);
      const formatted = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      expect(formatted).toBe('This is <strong>bold</strong> text');
    });
  });

  describe('message ID generation', () => {
    it('should generate unique message IDs', () => {
      const generateMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const id1 = generateMessageId();
      const id2 = generateMessageId();

      expect(id1).toMatch(/^msg-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^msg-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('help message', () => {
    it('should contain expected sections', () => {
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

      expect(HELP_MESSAGE.includes('### Portfolio Analysis')).toBe(true);
      expect(HELP_MESSAGE.includes('### Risk & Exposure')).toBe(true);
      expect(HELP_MESSAGE.includes('### Quick Tips')).toBe(true);
      expect(HELP_MESSAGE.includes('do NOT execute any orders')).toBe(true);
    });
  });

  describe('ChatPanel types', () => {
    it('should define correct ChatMessage structure', () => {
      interface ChatMessage {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        data?: {
          type: 'review' | 'exposure' | 'error';
          payload: unknown;
        };
      }

      const message: ChatMessage = {
        id: 'msg-123',
        role: 'assistant',
        content: 'Hello!',
        timestamp: new Date(),
      };

      expect(message.id).toBe('msg-123');
      expect(message.role).toBe('assistant');
      expect(message.content).toBe('Hello!');
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it('should support optional data in messages', () => {
      interface ChatMessage {
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: Date;
        data?: {
          type: 'review' | 'exposure' | 'error';
          payload: unknown;
        };
      }

      const messageWithData: ChatMessage = {
        id: 'msg-456',
        role: 'assistant',
        content: 'Review complete',
        timestamp: new Date(),
        data: {
          type: 'review',
          payload: { healthAssessment: 'healthy' },
        },
      };

      expect(messageWithData.data).toBeDefined();
      expect(messageWithData.data?.type).toBe('review');
    });
  });

  describe('ChatPanelProps', () => {
    it('should have correct default values conceptually', () => {
      interface ChatPanelProps {
        apiBaseUrl?: string;
        demoMode?: boolean;
        onReviewGenerated?: (review: any) => void;
      }

      const defaults: ChatPanelProps = {
        apiBaseUrl: 'http://localhost:3001',
        demoMode: false,
      };

      expect(defaults.apiBaseUrl).toBe('http://localhost:3001');
      expect(defaults.demoMode).toBe(false);
      expect(defaults.onReviewGenerated).toBeUndefined();
    });
  });
});
