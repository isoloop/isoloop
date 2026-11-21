import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  budgetFor,
  entriesOf,
  measure,
  overBudget,
  undeclaredScripts,
  type Measured,
} from './bundle-size.ts';

const root = join(import.meta.dirname, '../..');

describe('the bundle guard', () => {
  it('sets a budget at the size plus 5%, rounded up to the next 0.5 KB', () => {
    expect(budgetFor(0)).toBe(0);
    expect(budgetFor(92)).toBe(512);
    expect(budgetFor(1332)).toBe(1536);
    expect(budgetFor(67_396)).toBe(71_168);
  });

  it('fails a size over its budget, and one with no budget', () => {
    const measured: Measured = new Map([
      ['app:host page', { min: 70_000, gzip: 24_000 }],
      ['import-time:@isoloop/host', { min: 600, gzip: 300 }],
      ['script:@isoloop/bus/worker', { min: 100, gzip: 80 }],
    ]);
    const problems = overBudget(measured, {
      'app:host page': 70_656,
      'import-time:@isoloop/host': 512,
    });
    expect(problems.map((p) => p.item)).toEqual([
      'import-time:@isoloop/host',
      'script:@isoloop/bus/worker',
    ]);
    expect(problems[0]?.message).toContain('600 B minified is over its budget of 512 B');
    expect(problems[1]?.message).toContain('has no budget');
  });

  it('fails a script its package.json leaves out of sideEffects', () => {
    const manifest = {
      name: '@x/bus',
      sideEffects: false,
      exports: {
        '.': {
          '@isoloop/source': './src/index.ts',
          types: './dist/index.d.ts',
          import: './dist/index.js',
        },
        './worker': { '@isoloop/source': './src/worker.ts', import: './dist/bus-worker.js' },
      },
    };
    const entries = entriesOf('packages/bus', manifest);
    expect(entries.map((e) => [e.spec, e.typed])).toEqual([
      ['@x/bus', true],
      ['@x/bus/worker', false],
    ]);
    expect(undeclaredScripts(entries, manifest).map((p) => p.message)).toEqual([
      expect.stringContaining('sideEffects must name ./src/worker.ts'),
      expect.stringContaining('sideEffects must name ./dist/bus-worker.js'),
    ]);
    const declared = { ...manifest, sideEffects: ['./src/worker.ts', './dist/bus-worker.js'] };
    expect(undeclaredScripts(entries, declared)).toEqual([]);
  });

  it('measures a planted top-level side effect, which `sideEffects: false` would hide', async () => {
    const pure = {
      entry: "import 'lib';",
      lib: 'export const a = 1;\nexport const b = () => a;\n',
    };
    const planted = {
      ...pure,
      lib: `${pure.lib}customElements.define('x-y', class extends HTMLElement {});\n`,
    };
    const opts = { input: 'entry', sideEffects: true } as const;
    expect((await measure(root, { ...opts, modules: pure })).min).toBe(0);
    expect((await measure(root, { ...opts, modules: planted })).min).toBeGreaterThan(0);
  });
});
