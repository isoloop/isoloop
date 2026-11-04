import { PROTOCOL } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';

describe('bus (node)', () => {
  it('resolves @isoloop/protocol from source', () => {
    expect(PROTOCOL.v).toBe(1);
  });

  it('runs without a DOM', () => {
    expect('document' in globalThis).toBe(false);
  });
});
