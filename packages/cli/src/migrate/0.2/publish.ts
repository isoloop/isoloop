/*
 * 0.2's `publish` takes the value first (#411), like `request`,
 * `reply` and `usePublish`.
 *
 *   ctx.bus.publish(t, { value: v })          → ctx.bus.publish(t, v)
 *   ctx.bus.publish(t, { value: v, key: k })  → ctx.bus.publish(t, v, { key: k })
 *   kernel.publish(t, { key, value })         → kernel.publish(t, value, { key })
 *
 *   bus.publish(t, k === undefined ? { value } : { key: k, value })
 *                                             → bus.publish(t, value, k === undefined ? {} : { key: k })
 *
 * Which calls are Isoloop's: a `.publish(…)` whose receiver is named `bus`
 * or `kernel`, as a variable or as the last member of a chain (`ctx.bus`,
 * `bus`, `this.kernel`, `this.#kernel`, `kernel`…), or is a variable the
 * file sets from `createKernel(…)`. A receiver the file sets to `new …(…)`,
 * as a variable or a class field, is another library's and left alone. Any
 * other receiver (`this.#k`, a parameter, an import) can't be told apart,
 * so a call on it that would be rewritten or flagged is flagged instead.
 *
 * Which calls it rewrites: two arguments, the second an object literal
 * holding `value` and at most `key`, or a conditional whose two branches are
 * such object literals with the same `value` text. A multi-line value moves
 * out by the indentation its `value:` line had, except for lines that start
 * inside a string or template literal; comments inside the value stay, and
 * comments elsewhere in the removed object go with it. It flags, without
 * rewriting: a second argument that spreads (`{ ...rec }`), an object with
 * `value` and other fields, a variable the file sets to an object with
 * `value`, a value that is itself such an object, a conditional (or `??`,
 * `||`, `&&`) with such a branch that it can't rewrite, and spread
 * arguments. Everything else is left alone, since a 0.2 call
 * `publish(t, v)` looks the same as a 0.1 call that passes its record in a
 * variable; TypeScript and the topic's schema report those.
 */
import type { Edit, Flag } from '../edit';
import { child, children, type Node, type SourceFile, walk } from '../parser';
import type { Transform } from '../step';

const FLAG = 'publish takes (topic, value, { key }) since 0.2; check this call by hand';

/** A property's name, for `value`, `'value'` and `value` shorthand; `undefined` when computed. */
function keyName(prop: Node): string | undefined {
  if (prop['computed'] === true) return undefined;
  const key = child(prop, 'key');
  if (key?.type === 'Identifier' && typeof key['name'] === 'string') return key['name'];
  if (key?.type === 'Literal' && typeof key['value'] === 'string') return key['value'];
  return undefined;
}

/** The name an identifier node holds. */
const nameOf = (n: Node | undefined): string | undefined =>
  n?.type === 'Identifier' && typeof n['name'] === 'string' ? n['name'] : undefined;

/** A member's name: `x` for `.x`, `#x` for `.#x`. */
const propName = (n: Node | undefined): string | undefined =>
  n?.type === 'PrivateIdentifier' && typeof n['name'] === 'string' ? `#${n['name']}` : nameOf(n);

/** An expression with `TS*` wrappers and parentheses taken off (`x as T`, `x!`, `(x)`). */
function bare(n: Node): Node {
  let cur = n;
  for (;;) {
    const inner =
      cur.type === 'TSAsExpression' ||
      cur.type === 'TSSatisfiesExpression' ||
      cur.type === 'TSNonNullExpression' ||
      cur.type === 'ParenthesizedExpression'
        ? child(cur, 'expression')
        : undefined;
    if (inner === undefined) return cur;
    cur = inner;
  }
}

/** `createKernel(…)` or `await createKernel(…)`. */
function isCreateKernel(init: Node | undefined): boolean {
  if (init === undefined) return false;
  let n = bare(init);
  if (n.type === 'AwaitExpression') {
    const arg = child(n, 'argument');
    if (arg === undefined) return false;
    n = bare(arg);
  }
  return n.type === 'CallExpression' && nameOf(child(n, 'callee')) === 'createKernel';
}

/** An object literal with a `value` property. */
function hasValueProp(n: Node): boolean {
  return (
    n.type === 'ObjectExpression' && children(n, 'properties').some((p) => keyName(p) === 'value')
  );
}

/** An expression that may be one of several (`c ? a : b`, `a ?? b`, `a || b`): the ones it may be. */
function branches(n: Node): Node[] {
  const b = bare(n);
  if (b.type === 'ConditionalExpression') {
    return [child(b, 'consequent'), child(b, 'alternate')]
      .filter((x) => x !== undefined)
      .flatMap(branches);
  }
  if (b.type === 'LogicalExpression') {
    return [child(b, 'left'), child(b, 'right')].filter((x) => x !== undefined).flatMap(branches);
  }
  return [b];
}

/** A 0.1 record's parts: its `value` and its `key`, if any. */
type Rec = { readonly value: Node; readonly key: Node | undefined; readonly keyShorthand: boolean };

/** The start of the line `at` is on. */
const lineStart = (text: string, at: number): number => text.lastIndexOf('\n', at - 1) + 1;

/** The whitespace that starts the line `at` is on. */
const indentAt = (text: string, at: number): string =>
  /^[ \t]*/.exec(text.slice(lineStart(text, at)))?.[0] ?? '';

/** What a call's receiver is: Isoloop's, another library's, or not known. */
type Whose = 'ours' | 'foreign' | 'unknown';

export const publish: Transform = {
  summary: 'publish(topic, { value, key }) → publish(topic, value, { key })',
  mayChange: (text) => text.includes('publish'),
  transform(file: SourceFile) {
    const { text } = file;
    const slice = (n: Node): string => text.slice(n.start, n.end);

    // Variables the file sets: to `createKernel(…)`, to `new …(…)`, and to an
    // object with `value`. Class fields the file sets to `new …(…)`.
    const kernels = new Set<string>();
    const constructed = new Set<string>();
    const records = new Set<string>();
    walk(file.program, (node) => {
      if (node.type === 'PropertyDefinition' && node['computed'] !== true) {
        const name = propName(child(node, 'key'));
        const init = child(node, 'value');
        if (name !== undefined && init !== undefined && bare(init).type === 'NewExpression') {
          constructed.add(`this.${name}`);
        }
        return;
      }
      if (node.type !== 'VariableDeclarator') return;
      const name = nameOf(child(node, 'id'));
      const init = child(node, 'init');
      if (name === undefined || init === undefined) return;
      if (isCreateKernel(init)) kernels.add(name);
      else if (bare(init).type === 'NewExpression') constructed.add(name);
      if (hasValueProp(bare(init))) records.add(name);
    });

    /** Could `n` be a 0.1 record, so rewriting around it might be wrong? */
    const recordLike = (n: Node): boolean =>
      branches(n).some((b) => hasValueProp(b) || records.has(nameOf(b) ?? ''));

    /**
     * Whose `.publish` `callee` is. Isoloop's: a receiver named `bus` or
     * `kernel`, as a variable or the last member of a chain (`ctx.bus`,
     * `this.kernel`, `this.#kernel`), or a variable the file sets from
     * `createKernel(…)`. Another library's: a variable, or a `this.` field,
     * the file sets to `new …(…)`. `undefined` when it isn't a `.publish`.
     */
    const whose = (callee: Node): Whose | undefined => {
      if (callee.type !== 'MemberExpression' || callee['computed'] === true) return undefined;
      if (nameOf(child(callee, 'property')) !== 'publish') return undefined;
      const recv = child(callee, 'object');
      if (recv === undefined) return undefined;
      const r = bare(recv);
      const member = r.type === 'MemberExpression' && r['computed'] !== true;
      const name = member ? propName(child(r, 'property')) : nameOf(r);
      if (name === 'bus' || name === 'kernel' || name === '#bus' || name === '#kernel') {
        return 'ours';
      }
      if (r.type === 'Identifier' && kernels.has(name ?? '')) return 'ours';
      if (r.type === 'Identifier' && constructed.has(name ?? '')) return 'foreign';
      const obj = member ? child(r, 'object') : undefined;
      if (obj?.type === 'ThisExpression' && constructed.has(`this.${name ?? ''}`)) return 'foreign';
      return 'unknown';
    };

    /** An object literal's 0.1 record; `'flag'` when unsafe, `undefined` when it isn't one. */
    const recordOf = (obj: Node): Rec | 'flag' | undefined => {
      const props = children(obj, 'properties');
      if (!props.some((p) => keyName(p) === 'value')) return undefined; // already a 0.2 value
      let value: Node | undefined;
      let key: Node | undefined;
      let keyShorthand = false;
      for (const p of props) {
        const name =
          p.type === 'Property' && p['kind'] === 'init' && p['method'] !== true
            ? keyName(p)
            : undefined;
        const v = child(p, 'value');
        if (name === 'value' && v !== undefined) value = v;
        else if (name === 'key' && v !== undefined) {
          key = v;
          keyShorthand = p['shorthand'] === true;
        } else return 'flag';
      }
      if (value === undefined || recordLike(value)) return 'flag';
      return { value, key, keyShorthand };
    };

    /** The options a record's key becomes: `{ key }`, `{ key: k }`, or `undefined` for none. */
    const optsOf = (r: Rec): string | undefined =>
      r.key === undefined ? undefined : r.keyShorthand ? '{ key }' : `{ key: ${slice(r.key)} }`;

    /**
     * The value's text, with the lines after its first moved out by the
     * indentation the removed `value:` line had over `anchor`'s line. Lines
     * that start inside a string or template literal stay as they are.
     */
    const moved = (value: Node, anchor: Node): string => {
      const own = slice(value);
      if (!own.includes('\n')) return own;
      if (lineStart(text, value.start) === lineStart(text, anchor.start)) return own;
      const from = indentAt(text, value.start);
      const to = indentAt(text, anchor.start);
      if (from.length <= to.length || !from.startsWith(to)) return own;
      const drop = from.slice(to.length);
      const strings: Node[] = [];
      walk(value, (n) => {
        if (
          n.type === 'TemplateLiteral' ||
          (n.type === 'Literal' && typeof n['value'] === 'string')
        )
          strings.push(n);
      });
      let out = '';
      let at = value.start;
      for (let nl = text.indexOf('\n', value.start); nl !== -1 && nl < value.end;) {
        const line = nl + 1;
        const inString = strings.some((s) => s.start < line && line < s.end);
        if (!inString && text.startsWith(drop, line)) {
          out += text.slice(at, line);
          at = line + drop.length;
        }
        nl = text.indexOf('\n', line);
      }
      return out + text.slice(at, value.end);
    };

    /** What to do with a two-argument call's second argument: its new text, a flag, or nothing. */
    const rewrite = (second: Node): { readonly text: string } | 'flag' | undefined => {
      const arg = bare(second);
      if (arg.type === 'ObjectExpression') {
        const r = recordOf(arg);
        if (r === undefined || r === 'flag') return r;
        const opts = optsOf(r);
        return { text: `${moved(r.value, second)}${opts === undefined ? '' : `, ${opts}`}` };
      }
      if (arg.type === 'ConditionalExpression') {
        const test = child(arg, 'test');
        const [yes, no] = [child(arg, 'consequent'), child(arg, 'alternate')].map((b) =>
          b === undefined ? undefined : bare(b),
        );
        if (
          test !== undefined &&
          yes?.type === 'ObjectExpression' &&
          no?.type === 'ObjectExpression'
        ) {
          const [a, b] = [recordOf(yes), recordOf(no)];
          if (a === undefined && b === undefined) return undefined;
          if (typeof a !== 'object' || typeof b !== 'object') return 'flag';
          if (slice(a.value) !== slice(b.value)) return 'flag';
          const [oa, ob] = [optsOf(a), optsOf(b)];
          if (oa === undefined && ob === undefined) return { text: slice(a.value) };
          return { text: `${slice(a.value)}, ${slice(test)} ? ${oa ?? '{}'} : ${ob ?? '{}'}` };
        }
      }
      return recordLike(arg) ? 'flag' : undefined;
    };

    const edits: Edit[] = [];
    const flags: Flag[] = [];
    walk(file.program, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = child(node, 'callee');
      const who = callee === undefined ? undefined : whose(callee);
      if (who === undefined || who === 'foreign') return;
      const args = children(node, 'arguments');
      if (args.some((a) => a.type === 'SpreadElement')) {
        flags.push({ at: node.start, message: FLAG });
        return;
      }
      const [, second] = args;
      if (args.length !== 2 || second === undefined) return;
      const out = rewrite(second);
      if (out === undefined) return;
      // A receiver it can't name gets the flag where Isoloop's would be rewritten.
      if (out === 'flag' || who === 'unknown') flags.push({ at: node.start, message: FLAG });
      else edits.push({ start: second.start, end: second.end, text: out.text });
    });
    return { edits, flags };
  },
};
