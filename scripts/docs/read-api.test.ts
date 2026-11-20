// The conformance suite for readApi (M4c, decision 32): what the docs scripts
// rely on, whatever reads the `.d.ts` behind it.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { kindOf, readApi, type ApiExport, type ApiModel } from './read-api.ts';

const dir = join(import.meta.dirname, '__fixtures__/api');
let api: ApiModel;
const get = (entry: string, name: string): ApiExport => {
  const x = api.entries.get(entry)?.find((e) => e.name === name);
  if (!x) throw new Error(`${entry} ${name} missing`);
  return x;
};
/** Every declaration reachable from `key` through `refs`. */
const reach = (key: string): Set<string> => {
  const seen = new Set<string>();
  const q = [key];
  for (let k = q.pop(); k !== undefined; k = q.pop()) {
    if (seen.has(k)) continue;
    seen.add(k);
    q.push(...(api.refs.get(k) ?? []));
  }
  return seen;
};

beforeAll(() => {
  api = readApi(
    [
      { entry: 'alpha', file: join(dir, 'alpha/index.d.ts') },
      { entry: 'beta', file: join(dir, 'beta/index.d.ts') },
    ],
    dir,
  );
}, 30_000);

describe('readApi', () => {
  it('lists each entry point in the order given', () => {
    expect([...api.entries.keys()]).toEqual(['alpha', 'beta']);
    const beta = api.entries.get('beta')?.map((e) => e.name) ?? [];
    beta.sort();
    expect(beta).toEqual(['Made', 'make', 'use']);
  });

  it('gives each export its kind; a value merged with a type is the value', () => {
    expect(get('alpha', 'make').kind).toBe('function');
    expect(get('alpha', 'LIMIT').kind).toBe('const');
    expect(get('alpha', 'Oops').kind).toBe('class');
    expect(get('alpha', 'Colour').kind).toBe('enum');
    expect(get('alpha', 'Made').kind).toBe('interface');
    expect(get('alpha', 'MakeOptions').kind).toBe('type');
    expect(get('alpha', 'Both').kind).toBe('const');
    expect(kindOf(1024)).toBe('namespace'); // NamespaceModule
  });

  it('leaves out @internal exports', () => {
    expect(api.entries.get('alpha')?.some((e) => e.name === 'secret')).toBe(false);
  });

  it('reads tags and whether there is a doc comment', () => {
    expect(get('alpha', 'make').tags).toContainEqual({
      name: 'experimental',
      text: 'The shape may change.',
    });
    expect(get('alpha', 'make').documented).toBe(true);
    expect(get('alpha', 'LIMIT').documented).toBe(false);
  });

  it('gives a re-export the same key, and the declaring package as its home', () => {
    expect(get('beta', 'Made').key).toBe(get('alpha', 'Made').key);
    expect(get('beta', 'make').home).toBe('alpha');
    expect(get('beta', 'use').home).toBe('beta');
  });

  it("gives each declaration's text, its doc comment and its named members", () => {
    const [make] = get('alpha', 'make').decls;
    expect(make?.text).toBe('export declare function make(o: MakeOptions): Made;');
    expect(make?.doc).toMatch(/^\/\*\*\n \* Makes a thing\.[\s\S]*\*\/$/);
    expect(get('alpha', 'LIMIT').decls[0]?.text).toBe('export declare const LIMIT: number;');
    expect(get('alpha', 'LIMIT').decls[0]?.doc).toBe('');
    const oops = get('alpha', 'Oops').decls[0];
    expect(oops?.members.map((m) => [m.name, m.text])).toEqual([['code', 'code: string;']]);
    const [inner] = get('alpha', 'MakeOptions').decls[0]?.members ?? [];
    expect(inner).toEqual({
      name: 'inner',
      text: 'inner: Inner;',
      doc: '/** Nested, so the graph has to follow fields. */',
    });
  });

  it('follows parameter, return, field and heritage types', () => {
    const from = reach(get('alpha', 'make').key);
    for (const n of ['MakeOptions', 'Inner', 'Made', 'Base'])
      expect(from.has(get('alpha', n).key)).toBe(true);
    expect(from.has(get('alpha', 'Lonely').key)).toBe(false);
    expect(reach(get('beta', 'use').key).has(get('alpha', 'Base').key)).toBe(true);
  });
});
