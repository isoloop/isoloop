import { describe, expect, it } from 'vitest';
import {
  changedJs,
  dropInternal,
  exportedNames,
  internalNames,
  normaliseJs,
  removedNames,
  statements,
  surfaceOf,
  unannouncedJs,
} from './api-check.ts';

describe('dropInternal', () => {
  it('drops an @internal type alias whose type arguments hold commas', () => {
    const src = [
      '/** @internal */',
      "type A = Envelope<'hello', P> | Envelope<'result', R>;",
      'export type B = { x: number };',
      '/** @internal */',
      'declare const f: (a: Map<string, number>) => Set<string>;',
      'export { B };',
    ].join('\n');
    const out = dropInternal(src);
    expect(out).not.toContain('Envelope');
    expect(out).not.toContain('Map<');
    expect(out).toContain('export type B = { x: number };');
    expect(out).toContain('export { B };');
  });

  it('still ends an @internal member at its comma', () => {
    const out = dropInternal('declare const o: {\n  /** @internal */\n  a: 1,\n  b: 2,\n};');
    expect(out).not.toContain('a: 1');
    expect(out).toContain('b: 2');
  });
});

const pkg = (src: string): Set<string> => new Set(statements(src));

describe('exportedNames and removedNames (docs:check item 5)', () => {
  it('reads export lists and export declarations', () => {
    const names = exportedNames(
      pkg(
        [
          'declare function createKernel(): void;',
          'interface Kernel { a: number }',
          'export { createKernel, Kernel as K, type Other };',
          'export declare const VERSION: string;',
          'export interface Grants { inspect?: boolean }',
        ].join('\n'),
      ),
    );
    expect(names).toEqual(new Set(['Grants', 'K', 'Other', 'VERSION', 'createKernel']));
  });

  it('reports a name gone from every package, not one that moved', () => {
    const before = new Map([
      ['@x/a', pkg('export { oldName, moved };')],
      ['@x/b', pkg('export { kept };')],
    ]);
    const now = new Map([
      ['@x/a', pkg('export { newName };')],
      ['@x/b', pkg('export { kept, moved };')],
    ]);
    expect([...removedNames(before, now)]).toEqual(['oldName']);
  });
});

describe('surfaceOf: names and their declarations (ADR 0021, decision 8)', () => {
  // How tsdown writes an entry with `export *`, and with an explicit list.
  const star = [
    'export type Envelope<T extends string, P> = { v: 1; t: T; p: P };',
    'export declare const PROTOCOL: { readonly v: 1 };',
    'export declare function isEnvelope(x: unknown): boolean;',
  ].join('\n');
  const listed = [
    'type Envelope<T extends string, P> = { v: 1; t: T; p: P };',
    'declare const PROTOCOL: { readonly v: 1 };',
    'declare function isEnvelope(x: unknown): boolean;',
    'export { PROTOCOL, isEnvelope };',
    'export type { Envelope };',
  ].join('\n');

  it('reads an explicit list the same as exported declarations', () => {
    expect(surfaceOf([listed])).toEqual(surfaceOf([star]));
  });

  it("drops an @internal name from a list with its declaration, and ignores lists' type modifiers", () => {
    const withInternal = [
      '/** @internal */',
      'declare class Broker { private x; }',
      '/** @internal */',
      'type BusPort = { send(): void };',
      'declare function topic(): void;',
      'export { Broker, topic, type BusPort };',
    ].join('\n');
    expect(surfaceOf([withInternal])).toEqual(
      surfaceOf(['export declare function topic(): void;']),
    );
    expect(internalNames(withInternal)).toEqual(new Set(['Broker', 'BusPort']));
  });

  it('still counts a changed declaration, an added name and a removed one', () => {
    const a = surfaceOf(['export declare function f(a: string): void;']);
    expect(surfaceOf(['export declare function f(a: number): void;'])).not.toEqual(a);
    expect(surfaceOf(['declare function f(a: string): void;\nexport { f as g };'])).not.toEqual(a);
    const before = new Map([['@x/a', surfaceOf([listed])]]);
    const now = new Map([
      [
        '@x/a',
        surfaceOf([listed.replace('export { PROTOCOL, isEnvelope };', 'export { PROTOCOL };')]),
      ],
    ]);
    expect([...removedNames(before, now)]).toEqual(['isEnvelope']);
  });
});

const js = (files: Record<string, string>): Map<string, string> => new Map(Object.entries(files));

describe('the JS notice', () => {
  it("ignores tsdown's module comments and chunk hashes", () => {
    const before = '// src/kernel.ts\nconst a = 1;\nimport { b } from "./records-qo23ZEsQ.js";\n';
    const moved =
      '// src/kernel/kernel.ts\nconst a = 1;\n// ../protocol/dist/index.js\nimport { b } from "./records-Ab_cd-12.js";\n';
    expect(normaliseJs(moved)).toBe(normaliseJs(before));
    expect(normaliseJs('const a = 2;\n')).not.toBe(normaliseJs('const a = 1;\n'));
  });

  it('lists the packages whose JS changed with no changeset bumping them', () => {
    const before = new Map([
      ['@x/a', js({ 'index.js': 'one' })],
      ['@x/b', js({ 'index.js': 'one' })],
      ['@x/c', js({ 'index.js': 'one' })],
    ]);
    const now = new Map([
      ['@x/a', js({ 'index.js': 'two', 'extra.js': 'new' })],
      ['@x/b', js({ 'index.js': 'two' })],
      ['@x/c', js({ 'index.js': 'one' })],
    ]);
    expect(changedJs(js({ 'a.js': '1' }), js({ 'a.js': '1' }))).toEqual([]);
    expect(unannouncedJs(before, now, new Map([['@x/b', 'patch']]))).toEqual([
      { name: '@x/a', files: ['extra.js', 'index.js'] },
    ]);
  });
});
