import { describe, expect, it } from 'vitest';
import { dropInternal, exportedNames, removedNames, statements } from './api-check.ts';

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
