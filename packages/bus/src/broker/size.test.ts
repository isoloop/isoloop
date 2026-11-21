import { describe, expect, it } from 'vitest';
import { estimateSize } from './size';

describe('estimateSize', () => {
  it('grows with content', () => {
    expect(estimateSize('x'.repeat(1000))).toBeGreaterThan(2000);
    expect(estimateSize({ a: 'x'.repeat(1000) })).toBeGreaterThan(estimateSize('x'.repeat(1000)));
    expect(estimateSize(new Uint8Array(4096))).toBeGreaterThan(4096);
    expect(estimateSize([1, 2, 3])).toBeLessThan(64);
    expect(estimateSize(new Map([['k', 'x'.repeat(500)]]))).toBeGreaterThan(1000);
  });

  it('counts a cycle once and stops early past the limit', () => {
    const a: Record<string, unknown> = { s: 'x'.repeat(100) };
    a['self'] = a;
    expect(estimateSize(a)).toBeLessThan(400);
    const big = { a: 'x'.repeat(10_000), b: 'x'.repeat(10_000), c: 'x'.repeat(10_000) };
    const early = estimateSize(big, 1000);
    expect(early).toBeGreaterThan(1000);
    expect(early).toBeLessThan(estimateSize(big));
  });
});
