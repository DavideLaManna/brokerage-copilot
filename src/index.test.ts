import { describe, it, expect } from 'vitest';
import { VERSION } from './index';

describe('Options Trading Copilot', () => {
  it('should have a version number', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
