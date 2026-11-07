import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRequires, createDeprecations, FLOOR, VERSION } from './version';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('[FLOOR, VERSION] (ADR 0012)', () => {
  const range = { floor: '0.3', version: '0.6' };

  it('runs a stamp inside the range, and an unstamped or unparseable one', () => {
    for (const r of ['0.3', '0.4', '0.6', '0.6.9', undefined, 'next']) {
      expect(checkRequires(r, range), String(r)).toEqual({ ok: true });
    }
  });

  it('refuses a newer stamp as runtime-too-old and an older one as isolate-too-old', () => {
    expect(checkRequires('0.7', range)).toEqual({
      ok: false,
      reason: 'runtime-too-old',
      message: 'built for 0.7, this host runs 0.3 to 0.6',
    });
    expect(checkRequires('0.2', range)).toEqual({
      ok: false,
      reason: 'isolate-too-old',
      message: 'built for 0.2, this host runs 0.3 to 0.6',
    });
    expect(checkRequires('0.10', range)).toMatchObject({ reason: 'runtime-too-old' });
  });

  it('defaults to this host: VERSION is major.minor and the floor is at or below it', () => {
    expect(VERSION).toMatch(/^\d+\.\d+$/);
    expect(checkRequires(FLOOR)).toEqual({ ok: true });
    expect(checkRequires(VERSION)).toEqual({ ok: true });
  });

  it('deprecated() warns once per member, only in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createDeprecations(false)('ctx.old');
    expect(warn).not.toHaveBeenCalled();
    const deprecated = createDeprecations(true);
    deprecated('ctx.old', 'ctx.new');
    deprecated('ctx.old', 'ctx.new');
    deprecated('ctx.other');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain('ctx.old is deprecated; use ctx.new');
  });
});
