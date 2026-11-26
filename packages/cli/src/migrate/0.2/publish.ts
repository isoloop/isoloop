/*
 * 0.2's `publish` takes the value first (#411), like `request`,
 * `reply` and `usePublish`.
 *
 *   ctx.bus.publish(t, { value: v })          → ctx.bus.publish(t, v)
 *   ctx.bus.publish(t, { value: v, key: k })  → ctx.bus.publish(t, v, { key: k })
 *   kernel.publish(t, { key, value })         → kernel.publish(t, value, { key })
 *
 * Which calls are Isoloop's: a `.publish(…)` whose receiver is named `bus`
 * or `kernel` (`ctx.bus`, `bus`, `this.kernel`, `kernel`…), or is a variable
 * the file sets from `createKernel(…)`. Any other `.publish` is left alone.
 *
 * Which calls it rewrites: two arguments, the second an object literal
 * holding `value` and at most `key`. It flags, without rewriting: a second
 * argument that spreads (`{ ...rec }`), an object with `value` and other
 * fields, a variable the file sets to an object with `value`, a value that
 * is itself such an object, and spread arguments. Everything else is left
 * alone, since a 0.2 call `publish(t, v)` looks the same as a 0.1 call that
 * passes its record in a variable; TypeScript and the topic's schema report
 * those.
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

export const publish: Transform = {
  summary: 'publish(topic, { value, key }) → publish(topic, value, { key })',
  mayChange: (text) => text.includes('publish'),
  transform(file: SourceFile) {
    const { text } = file;
    const slice = (n: Node): string => text.slice(n.start, n.end);

    // Variables the file sets: to `createKernel(…)`, and to an object with `value`.
    const kernels = new Set<string>();
    const records = new Set<string>();
    walk(file.program, (node) => {
      if (node.type !== 'VariableDeclarator') return;
      const name = nameOf(child(node, 'id'));
      const init = child(node, 'init');
      if (name === undefined || init === undefined) return;
      if (isCreateKernel(init)) kernels.add(name);
      if (hasValueProp(bare(init))) records.add(name);
    });

    /** Could `n` be a 0.1 record, so rewriting around it might be wrong? */
    const recordLike = (n: Node): boolean => {
      const b = bare(n);
      return hasValueProp(b) || records.has(nameOf(b) ?? '');
    };

    /** Is `callee` `<bus or kernel>.publish`? */
    const isOurs = (callee: Node): boolean => {
      if (callee.type !== 'MemberExpression' || callee['computed'] === true) return false;
      if (nameOf(child(callee, 'property')) !== 'publish') return false;
      const recv = child(callee, 'object');
      if (recv === undefined) return false;
      const r = bare(recv);
      const name =
        r.type === 'MemberExpression' && r['computed'] !== true
          ? nameOf(child(r, 'property'))
          : nameOf(r);
      if (name === 'bus' || name === 'kernel') return true;
      return r.type === 'Identifier' && kernels.has(name ?? '');
    };

    const edits: Edit[] = [];
    const flags: Flag[] = [];
    walk(file.program, (node) => {
      if (node.type !== 'CallExpression') return;
      const callee = child(node, 'callee');
      if (callee === undefined || !isOurs(callee)) return;
      const args = children(node, 'arguments');
      if (args.some((a) => a.type === 'SpreadElement')) {
        flags.push({ at: node.start, message: FLAG });
        return;
      }
      const [, second] = args;
      if (args.length !== 2 || second === undefined) return;
      const arg = bare(second);
      if (arg.type !== 'ObjectExpression') {
        if (recordLike(arg)) flags.push({ at: node.start, message: FLAG });
        return;
      }
      const props = children(arg, 'properties');
      if (!props.some((p) => keyName(p) === 'value')) return; // already a 0.2 value
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
        } else {
          flags.push({ at: node.start, message: FLAG });
          return;
        }
      }
      if (value === undefined || recordLike(value)) {
        flags.push({ at: node.start, message: FLAG });
        return;
      }
      const opts = key === undefined ? '' : keyShorthand ? ', { key }' : `, { key: ${slice(key)} }`;
      edits.push({ start: second.start, end: second.end, text: `${slice(value)}${opts}` });
    });
    return { edits, flags };
  },
};
