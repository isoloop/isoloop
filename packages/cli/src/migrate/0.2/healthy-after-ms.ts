/*
 * 0.2 gives the healthy run that clears the count of short runs its own
 * option, `supervisor.healthyAfterMs` (#409, ADR 0001). On 0.1 that run was
 * `withinMs`, so a config that sets `withinMs` gets `healthyAfterMs` set to the
 * same expression, which keeps its restart limit as it was.
 *
 * It looks at `createKernel(…)` calls: an object literal passed to it, or one
 * the same file assigns to the variable passed to it. Inside, a `supervisor`
 * object literal that sets `withinMs` and not `healthyAfterMs` gets
 * `healthyAfterMs: <the same expression>` after `withinMs`. It flags what it
 * can't read safely: a spread in either object, a `supervisor` that isn't an
 * object literal, and a `withinMs` whose expression may have effects (a call,
 * an assignment), which copying would run twice.
 */
import type { Edit, Flag } from '../edit';
import { child, children, walk, type Node } from '../parser';
import type { Transform } from '../step';

/** `x as T`, `x satisfies T`, `x!` and `(x)` are `x`. */
function unwrap(node: Node | undefined): Node | undefined {
  let n = node;
  while (
    n !== undefined &&
    (n.type === 'TSAsExpression' ||
      n.type === 'TSSatisfiesExpression' ||
      n.type === 'TSNonNullExpression' ||
      n.type === 'ParenthesizedExpression')
  )
    n = child(n, 'expression');
  return n;
}

/** The name a non-computed property is keyed by. */
function keyOf(prop: Node): string | undefined {
  if (prop.type !== 'Property' || prop['computed'] === true) return undefined;
  const key = child(prop, 'key');
  if (key?.type === 'Identifier' && typeof key['name'] === 'string') return key['name'];
  if (key?.type === 'Literal' && typeof key['value'] === 'string') return key['value'];
  return undefined;
}

/** Is `name` the callee of `call`, as `name(…)` or `x.name(…)`? */
function calls(call: Node, name: string): boolean {
  const callee = unwrap(child(call, 'callee'));
  if (callee?.type === 'Identifier') return callee['name'] === name;
  if (callee?.type === 'MemberExpression' && callee['computed'] !== true)
    return child(callee, 'property')?.['name'] === name;
  return false;
}

/** Does evaluating `expr` maybe do something, so it mustn't be copied? */
function hasEffects(expr: Node): boolean {
  let found = false;
  walk(expr, (n) => {
    if (
      n.type === 'CallExpression' ||
      n.type === 'NewExpression' ||
      n.type === 'AssignmentExpression' ||
      n.type === 'UpdateExpression' ||
      n.type === 'AwaitExpression' ||
      n.type === 'YieldExpression' ||
      n.type === 'TaggedTemplateExpression'
    )
      found = true;
  });
  return found;
}

const KEEP = 'set `healthyAfterMs` to the same value as `withinMs` to keep the 0.1 restart limit';

export const healthyAfterMs: Transform = {
  summary: 'supervisor.healthyAfterMs set beside supervisor.withinMs',
  mayChange: (text) => text.includes('createKernel') && text.includes('withinMs'),
  transform(file) {
    const { text, program } = file;
    const edits: Edit[] = [];
    const flags: Flag[] = [];
    // Object literals assigned to a variable, by name, for `createKernel(config)`.
    const assigned = new Map<string, Node[]>();
    const callsToKernel: Node[] = [];
    walk(program, (n) => {
      if (n.type === 'VariableDeclarator') {
        const id = child(n, 'id');
        const init = unwrap(child(n, 'init'));
        if (
          id?.type === 'Identifier' &&
          typeof id['name'] === 'string' &&
          init?.type === 'ObjectExpression'
        )
          assigned.set(id['name'], [...(assigned.get(id['name']) ?? []), init]);
      }
      if (n.type === 'CallExpression' && calls(n, 'createKernel')) callsToKernel.push(n);
    });

    const done = new Set<Node>();
    const config = (obj: Node): void => {
      if (done.has(obj)) return;
      done.add(obj);
      const props = children(obj, 'properties');
      const supervisor = props.find((p) => keyOf(p) === 'supervisor');
      if (supervisor === undefined) {
        const spread = props.find((p) => p.type === 'SpreadElement');
        if (spread)
          flags.push({
            at: spread.start,
            message: `a spread may set supervisor.withinMs: ${KEEP}`,
          });
        return;
      }
      const value = unwrap(child(supervisor, 'value'));
      if (value?.type !== 'ObjectExpression') {
        flags.push({
          at: supervisor.start,
          message: `\`supervisor\` isn't an object literal: ${KEEP}`,
        });
        return;
      }
      const inner = children(value, 'properties');
      if (inner.some((p) => keyOf(p) === 'healthyAfterMs')) return;
      const spread = inner.find((p) => p.type === 'SpreadElement');
      if (spread) {
        flags.push({ at: spread.start, message: `a spread in \`supervisor\`: ${KEEP}` });
        return;
      }
      const within = inner.find((p) => keyOf(p) === 'withinMs');
      const expr = within === undefined ? undefined : child(within, 'value');
      if (within === undefined || expr === undefined) return;
      if (hasEffects(expr)) {
        flags.push({ at: within.start, message: `\`withinMs\` is computed: ${KEEP}` });
        return;
      }
      // On its own line, the new property gets one too, indented the same.
      const lineStart = text.lastIndexOf('\n', within.start - 1) + 1;
      const indent = text.slice(lineStart, within.start);
      const sep = /^[ \t]*$/.test(indent)
        ? `,${text.includes('\r\n') ? '\r\n' : '\n'}${indent}`
        : ', ';
      edits.push({
        start: within.end,
        end: within.end,
        text: `${sep}healthyAfterMs: ${text.slice(expr.start, expr.end)}`,
      });
    };

    for (const call of callsToKernel) {
      const arg = unwrap(children(call, 'arguments')[0]);
      if (arg?.type === 'ObjectExpression') config(arg);
      else if (arg?.type === 'Identifier' && typeof arg['name'] === 'string') {
        const objs = assigned.get(arg['name']) ?? [];
        if (objs.length === 1 && objs[0]) config(objs[0]);
      }
    }
    return { edits, flags };
  },
};
