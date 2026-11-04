import { PROTOCOL } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';

describe('host (browser)', () => {
  it('resolves @isoloop/protocol from source', () => {
    expect(PROTOCOL.v).toBe(1);
  });

  it('runs in a real browser', () => {
    expect(typeof Worker).toBe('function');
  });
});
