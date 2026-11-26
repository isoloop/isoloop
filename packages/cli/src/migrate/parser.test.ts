// Conformance tests for the parser interface: what `isoloop migrate`'s steps
// rely on. A replacement for oxc-parser passes these unchanged.
import { describe, expect, it } from 'vitest';
import { child, children, EXTENSIONS, isNode, loadParser, walk, type Node } from './parser';

const parser = await loadParser();

/** Parses or fails the test. */
function parse(path: string, text: string): Node {
  const r = parser.parse(path, text);
  if (!r.ok) throw new Error(`didn't parse: ${r.errors.map((e) => e.message).join('; ')}`);
  expect(r.file.text).toBe(text);
  expect(r.file.path).toBe(path);
  return r.file.program;
}

/** Every node of `type`, in source order. */
function all(root: Node, type: string): Node[] {
  const out: Node[] = [];
  walk(root, (n) => {
    if (n.type === type) out.push(n);
  });
  return out;
}

const source = (text: string, n: Node): string => text.slice(n.start, n.end);

describe('the parser', () => {
  it('parses every extension migrate reads', () => {
    const samples: Record<string, string> = {
      '.ts': 'const a: number = 1 as number;\nexport type T = { a: string };\n',
      '.tsx': 'const A = (p: { n: number }) => <div>{p.n}</div>;\n',
      '.mts': 'export const a = 1 satisfies number;\n',
      '.cts': 'const a = 1 as number;\nexport = a;\n',
      '.js': 'export const a = (b) => b?.c ?? 1;\n',
      '.jsx': 'export const A = () => <a href="x">y</a>;\n',
      '.mjs': 'export default await Promise.resolve(1);\n',
      '.cjs': 'module.exports = { a: 1 };\n',
    };
    for (const ext of EXTENSIONS) {
      const text = samples[ext] ?? '';
      expect(text, ext).not.toBe('');
      const program = parse(`file${ext}`, text);
      expect(program.type).toBe('Program');
      expect(program.start).toBe(0);
    }
  });

  it('gives offsets as UTF-16 indexes into the text', () => {
    const text = 'const é = "ü😀";\nctx.bus.publish(t, { value: "日本" });\n';
    const program = parse('a.ts', text);
    const [call] = all(program, 'CallExpression');
    expect(call && source(text, call)).toBe('ctx.bus.publish(t, { value: "日本" })');
    const str = all(program, 'Literal').find((n) => n.value === '日本');
    expect(str && source(text, str)).toBe('"日本"');
  });

  it('reports a syntax error with a position, and gives no tree', () => {
    const r = parser.parse('bad.ts', 'const ok = 1;\nconst = 2;\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(0);
    const [e] = r.errors;
    expect(e?.message).toMatch(/\S/);
    expect(e?.start).toBe(20);
  });

  it('refuses JSX in a .ts file, which TypeScript reads as a cast', () => {
    expect(parser.parse('a.ts', 'const a = <div>x</div>;\n').ok).toBe(false);
  });

  it('gives the ESTree shapes the steps read', () => {
    const text = [
      "import { publish as send, type T } from '@isoloop/runtime';",
      'ctx.bus.publish(topic, { value: v, key, ...rest });',
      "obj['computed'](1);",
      'const x = (a as T).b!;',
      '',
    ].join('\n');
    const program = parse('a.ts', text);

    const [imp] = all(program, 'ImportDeclaration');
    expect(imp && child(imp, 'source')?.value).toBe('@isoloop/runtime');
    const specifiers = imp ? children(imp, 'specifiers') : [];
    expect(specifiers.map((s) => s.type)).toEqual(['ImportSpecifier', 'ImportSpecifier']);
    const [named] = specifiers;
    expect(named && child(named, 'imported')?.name).toBe('publish');
    expect(named && child(named, 'local')?.name).toBe('send');

    const [call] = all(program, 'CallExpression');
    if (call === undefined) throw new Error('no call');
    const callee = child(call, 'callee');
    expect(callee?.type).toBe('MemberExpression');
    expect(callee?.computed).toBe(false);
    expect(callee && child(callee, 'property')?.name).toBe('publish');
    const inner = callee && child(callee, 'object');
    expect(inner?.type).toBe('MemberExpression');
    expect(inner && child(inner, 'object')?.name).toBe('ctx');

    const args = children(call, 'arguments');
    expect(args.map((a) => a.type)).toEqual(['Identifier', 'ObjectExpression']);
    const props = args[1] ? children(args[1], 'properties') : [];
    expect(props.map((p) => p.type)).toEqual(['Property', 'Property', 'SpreadElement']);
    const [value, key] = props;
    expect(value && child(value, 'key')?.name).toBe('value');
    expect(value && source(text, value)).toBe('value: v');
    expect(value?.shorthand).toBe(false);
    expect(key?.shorthand).toBe(true);

    const computed = all(program, 'MemberExpression').find((m) => m.computed === true);
    expect(computed && source(text, computed)).toBe("obj['computed']");

    expect(all(program, 'TSAsExpression')).toHaveLength(1);
    expect(all(program, 'TSNonNullExpression')).toHaveLength(1);
  });

  it('walks parents first, children in source order, with each parent', () => {
    const text = 'f(a, g(b), c);\n';
    const program = parse('a.ts', text);
    const seen: string[] = [];
    const parents = new Map<string, string | undefined>();
    walk(program, (n, parent) => {
      if (n.type === 'Identifier' || n.type === 'CallExpression') {
        seen.push(source(text, n));
        parents.set(source(text, n), parent && source(text, parent));
      }
    });
    expect(seen).toEqual(['f(a, g(b), c)', 'f', 'a', 'g(b)', 'g', 'b', 'c']);
    expect(parents.get('b')).toBe('g(b)');
    expect(parents.get('g(b)')).toBe('f(a, g(b), c)');
    let rootParent: unknown = 'unset';
    walk(program, (n, parent) => {
      if (n === program) rootParent = parent;
    });
    expect(rootParent).toBeUndefined();
  });

  it('tells nodes from other values', () => {
    expect(isNode({ type: 'X', start: 0, end: 1 })).toBe(true);
    expect(isNode({ type: 'X' })).toBe(false);
    expect(isNode(null)).toBe(false);
    expect(isNode('Identifier')).toBe(false);
  });
});
