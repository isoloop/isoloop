import { describe, expect, it } from 'vitest';
import { compareVersions, isIsolateToHost, majorMinor } from './index';

describe('version stamps (ADR 0012)', () => {
  it('majorMinor keeps major.minor and drops the rest', () => {
    expect(majorMinor('0.4.2')).toBe('0.4');
    expect(majorMinor('1.0.0-rc.1')).toBe('1.0');
    expect(majorMinor('0.10')).toBe('0.10');
    expect(majorMinor('v1')).toBeUndefined();
  });

  it('compareVersions orders numerically, not as text', () => {
    expect(compareVersions('0.10', '0.9')).toBeGreaterThan(0);
    expect(compareVersions('0.4', '0.4.7')).toBe(0);
    expect(compareVersions('1.0', '0.99')).toBeGreaterThan(0);
    expect(() => compareVersions('x', '0.1')).toThrow(/not a version/);
  });

  it('ready passes the guard with and without requires', () => {
    const p = { runtime: '@isoloop/runtime', adapter: 'vanilla', renderFmt: 'isoloop-dom@1' };
    expect(isIsolateToHost({ v: 1, t: 'ready', p })).toBe(true);
    expect(isIsolateToHost({ v: 1, t: 'ready', p: { ...p, requires: '0.4' } })).toBe(true);
  });
});
