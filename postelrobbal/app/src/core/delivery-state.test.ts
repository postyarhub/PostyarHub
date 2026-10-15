import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, nextRetryDelaySeconds } from './delivery-state.js';

describe('delivery state machine', () => {
  it('allows only the intended terminal/retry transitions', () => {
    expect(canTransition('PENDING', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'SENT')).toBe(true);
    expect(canTransition('PROCESSING', 'RETRYING')).toBe(true);
    expect(canTransition('SENT', 'PROCESSING')).toBe(false);
    expect(canTransition('CANCELLED', 'PENDING')).toBe(false);
    expect(() => assertTransition('SENT', 'PROCESSING')).toThrow();
  });

  it('uses bounded retry delays and stops at the max attempt count', () => {
    expect(nextRetryDelaySeconds(1)).toBe(30);
    expect(nextRetryDelaySeconds(2)).toBe(120);
    expect(nextRetryDelaySeconds(3)).toBe(600);
    expect(nextRetryDelaySeconds(4)).toBe(1800);
    expect(nextRetryDelaySeconds(5)).toBeNull();
    expect(nextRetryDelaySeconds(6)).toBeNull();
  });
});
