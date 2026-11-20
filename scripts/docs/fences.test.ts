// docs:check item 2: fences that type-check (M4c, decision 22), and item 5's
// matching of removed names in a guide's prose.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkRemovedNames } from './check.ts';
import { checkFences, extractFences, mapDiagnostics, moduleName, moduleSource } from './fences.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('extractFences', () => {
  it('takes ts and tsx fences at their first code line, and skips nocheck and other languages', () => {
    const md = [
      '# Guide', //            1
      '', //                   2
      '```ts', //              3
      'const a = 1;', //       4
      '```', //                5
      '```ts nocheck', //      6
      'not code', //           7
      '```', //                8
      '```json', //            9
      '{}', //                 10
      '```', //                11
      '```tsx', //             12
      'const b = <p />;', //   13
      '```', //                14
    ].join('\n');
    const fences = extractFences('docs/guide/x.md', md);
    expect(fences.map((f) => [f.lang, f.line, f.code])).toEqual([
      ['ts', 4, 'const a = 1;'],
      ['tsx', 13, 'const b = <p />;'],
    ]);
  });
});

describe('moduleSource', () => {
  it('gives a Preact tsx fence the jsx pragma and counts the line it adds', () => {
    const f = { file: 'g.md', line: 3, lang: 'tsx' as const, code: "import { h } from 'preact';" };
    const { text, offset } = moduleSource(f);
    expect(text.startsWith('/** @jsxImportSource preact */\n')).toBe(true);
    expect(offset).toBe(1);
  });
});

describe('mapDiagnostics', () => {
  it('maps a tsc error back to the guide line', () => {
    const f = { file: 'docs/guide/pools.md', line: 10, lang: 'ts' as const, code: '' };
    const byModule = new Map([[moduleName(f), { ...f, offset: 0 }]]);
    const out = mapDiagnostics(
      `node_modules/.cache/docs-fences/${moduleName(f)}(3,5): error TS2304: Cannot find name 'x'.`,
      byModule,
    );
    expect(out).toEqual([
      {
        file: 'docs/guide/pools.md:12',
        message: "fence doesn't type-check: TS2304: Cannot find name 'x'.",
      },
    ]);
  });
});

describe('checkFences', () => {
  it('passes a fence that uses the API as it is, and fails one that uses a name it lacks', () => {
    const good = [
      '```ts',
      "import { createKernel } from '@isoloop/host';",
      '',
      'createKernel({ contracts, workers });',
      'kernel.spawn({ id: "a", src: "/a.js", grants: { publish: [], subscribe: [] } });',
      '```',
    ].join('\n');
    const bad = [
      '# Bad',
      '',
      '```ts',
      'kernel.spawn({ id: "a", src: "/a.js", grants: { inspect: true } });',
      '```',
      '```ts nocheck',
      'this is not TypeScript',
      '```',
    ].join('\n');
    const problems = checkFences(
      root,
      [
        { file: 'docs/guide/good.md', md: good },
        { file: 'docs/guide/bad.md', md: bad },
      ],
      join(root, 'node_modules/.cache/docs-fences-test'),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe('docs/guide/bad.md:4');
    expect(problems[0]?.message).toContain('TS2739');
  }, 30_000);
});

describe('checkRemovedNames', () => {
  it('flags a removed name in inline code, with its line, and leaves fences to item 2', () => {
    const md = [
      '# Guide',
      '',
      'Call `kernel.oldCall()` first, then `newCall`.',
      '```ts',
      'oldCall();',
      '```',
    ].join('\n');
    expect(checkRemovedNames('docs/guide/x.md', md, new Set(['oldCall']))).toEqual([
      {
        file: 'docs/guide/x.md:3',
        message: 'names `oldCall`, which is no longer exported: update the guide',
      },
    ]);
  });
});
