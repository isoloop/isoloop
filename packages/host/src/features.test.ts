import { afterEach, describe, expect, it, vi } from 'vitest';
import { missingFeatures, type Feature } from './features';
import { createKernel, KernelError } from './index';

// Browser feature check (plan m1-kernel, task 3b).

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Worker that never reads its options, like an engine without module workers. */
function ClassicWorker(url: string): never {
  throw new SyntaxError(`bad URL ${url}`);
}
/** A ShadowRoot without `adoptedStyleSheets`. */
function OldShadowRoot(): void {}

const stubs: [Feature, () => void][] = [
  ['module-workers', () => vi.stubGlobal('Worker', ClassicWorker)],
  ['message-channel', () => vi.stubGlobal('MessageChannel', undefined)],
  ['adopted-stylesheets', () => vi.stubGlobal('ShadowRoot', OldShadowRoot)],
  ['opfs', () => vi.stubGlobal('navigator', { storage: {} })],
];

describe('browser feature check', () => {
  it('this browser has everything', () => {
    expect(missingFeatures()).toEqual([]);
  });

  it.each(stubs)('createKernel throws unsupported_browser without %s', (feature, stub) => {
    stub();
    expect(missingFeatures()).toEqual([feature]);
    let caught: unknown;
    try {
      createKernel({ workers: { isolateBootstrap: 'unused' } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KernelError);
    expect(caught).toMatchObject({ code: 'unsupported_browser' });
    expect(caught instanceof Error && caught.message).toContain(feature);
  });

  it('names every missing feature at once', () => {
    for (const [, stub] of stubs) stub();
    expect(missingFeatures()).toEqual(stubs.map(([f]) => f));
  });
});
