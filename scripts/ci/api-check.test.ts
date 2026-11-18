import { describe, expect, it } from 'vitest';
import { dropInternal } from './api-check.ts';

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
