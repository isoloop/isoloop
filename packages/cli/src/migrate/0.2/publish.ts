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
 * such object literals with the same `value` text. The new arguments are laid
 * out as oxfmt and Prettier lay them out, at the width the nearest config
 * sets: a call on one line stays on one line, and so does one that now fits;
 * arguments already one per line stay one per line; otherwise the value hugs
 * the call when there are no options, the options hug it after a value that
 * isn't an object, and the arguments go one per line when neither fits. A
 * member chain with at most two calls that now fits goes back on one line.
 * Lines that start inside a string or template literal never move. The
 * removed object's comments are kept: the key's go into the options, the
 * value's beside the value, and any after the last field above the call; a
 * conditional with a comment in a branch is flagged. It flags, without
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
import { DEFAULT_STYLE, type Style } from '../style';

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

/** A 0.1 record's parts: its `value` and its `key`, if any, with their properties. */
type Rec = {
  readonly value: Node;
  readonly valueProp: Node;
  readonly key: Node | undefined;
  readonly keyProp: Node | undefined;
  readonly keyShorthand: boolean;
};

/** A comment in the text, with whether it's a `//` comment. */
type Comment = { readonly start: number; readonly end: number; readonly text: string };

const isLine = (c: Comment): boolean => c.text.startsWith('//');

/** A removed object's comments, by where they go: beside the value, beside the key, or before the call. */
type Notes = {
  readonly valueLead: Comment[];
  readonly valueTrail: Comment[];
  readonly keyLead: Comment[];
  readonly keyTrail: Comment[];
  readonly other: Comment[];
};

/** The start of the line `at` is on. */
const lineStart = (text: string, at: number): number => text.lastIndexOf('\n', at - 1) + 1;

/** Where the line `at` is on ends, before its line break. */
function lineEnd(text: string, at: number): number {
  const nl = text.indexOf('\n', at);
  const end = nl === -1 ? text.length : nl;
  return text[end - 1] === '\r' ? end - 1 : end;
}

/** The whitespace that starts the line `at` is on. */
const indentAt = (text: string, at: number): string =>
  /^[ \t]*/.exec(text.slice(lineStart(text, at)))?.[0] ?? '';

/** The comments in `text` from `from` to `to`, outside the `skip` nodes and outside strings. */
function commentsIn(text: string, from: number, to: number, skip: readonly Node[]): Comment[] {
  const out: Comment[] = [];
  let i = from;
  while (i < to) {
    const over = skip.find((n) => n.start <= i && i < n.end);
    const ch = text[i];
    if (over !== undefined) i = over.end;
    else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < to && text[j] !== ch) j += text[j] === '\\' ? 2 : 1;
      i = j + 1;
    } else if (text.startsWith('//', i)) {
      const end = Math.min(lineEnd(text, i), to);
      out.push({ start: i, end, text: text.slice(i, end).trimEnd() });
      i = end;
    } else if (text.startsWith('/*', i)) {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? to : close + 2;
      out.push({ start: i, end, text: text.slice(i, end) });
      i = end;
    } else i++;
  }
  return out;
}

/** Comments as lines of their own, each at `indent`. */
const lines = (cs: readonly Comment[], indent: string): string =>
  cs.map((c) => `${indent}${c.text}\n`).join('');
/** Comments after the code they follow, on its line. */
const after = (cs: readonly Comment[]): string => cs.map((c) => ` ${c.text}`).join('');
/** Comments before the code they precede, on its line. */
const before = (cs: readonly Comment[]): string => cs.map((c) => `${c.text} `).join('');

/** What a rewrite puts in place of `{ value, key }`: the value, the options and their comments. */
type Parts = {
  readonly value: Node;
  /** The `key: …` text, `key` for shorthand; `undefined` when there's no key. */
  readonly key: string | undefined;
  /** The options as written when they aren't `{ key }`, such as a conditional. */
  readonly opts: string | undefined;
  readonly notes: Notes;
};

/** Notes with no comments. */
const noNotes = (): Notes => ({
  valueLead: [],
  valueTrail: [],
  keyLead: [],
  keyTrail: [],
  other: [],
});

/** What a call's receiver is: Isoloop's, another library's, or not known. */
type Whose = 'ours' | 'foreign' | 'unknown';

export const publish: Transform = {
  summary: 'publish(topic, { value, key }) → publish(topic, value, { key })',
  mayChange: (text) => text.includes('publish'),
  transform(file: SourceFile, style: Style = DEFAULT_STYLE) {
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
      let valueProp: Node | undefined;
      let key: Node | undefined;
      let keyProp: Node | undefined;
      let keyShorthand = false;
      for (const p of props) {
        const name =
          p.type === 'Property' && p['kind'] === 'init' && p['method'] !== true
            ? keyName(p)
            : undefined;
        const v = child(p, 'value');
        if (name === 'value' && v !== undefined) {
          value = v;
          valueProp = p;
        } else if (name === 'key' && v !== undefined) {
          key = v;
          keyProp = p;
          keyShorthand = p['shorthand'] === true;
        } else return 'flag';
      }
      if (value === undefined || valueProp === undefined || recordLike(value)) return 'flag';
      return { value, valueProp, key, keyProp, keyShorthand };
    };

    /** The comments of `obj`, the object `r` came from, sorted by where each goes. */
    const notesOf = (obj: Node, r: Rec): Notes => {
      const notes: Notes = { valueLead: [], valueTrail: [], keyLead: [], keyTrail: [], other: [] };
      const props = [r.valueProp, r.keyProp]
        .filter((p) => p !== undefined)
        .toSorted((x, y) => x.start - y.start);
      const skip = [r.value, ...(r.key === undefined || r.keyShorthand ? [] : [r.key])];
      const lead = (p: Node): Comment[] => (p === r.valueProp ? notes.valueLead : notes.keyLead);
      const trail = (p: Node): Comment[] => (p === r.valueProp ? notes.valueTrail : notes.keyTrail);
      for (const c of commentsIn(text, obj.start + 1, obj.end - 1, skip)) {
        const inside = props.find((p) => p.start <= c.start && c.start < p.end);
        const prev = props.findLast((p) => p.end <= c.start);
        const next = props.find((p) => p.start >= c.end);
        if (inside !== undefined) lead(inside).push(c);
        else if (prev !== undefined && !text.slice(prev.end, c.start).includes('\n')) {
          trail(prev).push(c);
        } else if (next !== undefined) lead(next).push(c);
        else notes.other.push(c);
      }
      return notes;
    };

    /**
     * `n`'s text placed so its first line's indentation is `target`: the
     * lines after its first move by the difference. Lines that start inside
     * a string or template literal stay as they are.
     */
    const placed = (n: Node, target: string): string => {
      const own = slice(n);
      const home = indentAt(text, n.start);
      if (!own.includes('\n') || home === target) return own;
      let drop = '';
      let add = '';
      if (home.startsWith(target)) drop = home.slice(target.length);
      else if (target.startsWith(home)) add = target.slice(home.length);
      else return own;
      const strings: Node[] = [];
      walk(n, (m) => {
        if (
          m.type === 'TemplateLiteral' ||
          (m.type === 'Literal' && typeof m['value'] === 'string')
        )
          strings.push(m);
      });
      let out = '';
      let at = n.start;
      for (let nl = text.indexOf('\n', n.start); nl !== -1 && nl < n.end;) {
        const line = nl + 1;
        nl = text.indexOf('\n', line);
        if (strings.some((s) => s.start < line && line < s.end)) continue;
        if (drop !== '' && text.startsWith(drop, line)) {
          out += text.slice(at, line);
          at = line + drop.length;
        } else if (add !== '' && !/^\r?\n/.test(text.slice(line, line + 2))) {
          out += text.slice(at, line) + add;
          at = line;
        }
      }
      return out + text.slice(at, n.end);
    };

    /** A line's width, with tabs counted as the formatter counts them. */
    const width = (line: string): number =>
      line.replaceAll('\t', ' '.repeat(style.tabWidth)).length;

    /** The options' text, on one line or, with `indent`, over several. */
    const optsText = (p: Parts, indent?: string): string | undefined => {
      if (p.opts !== undefined) return p.opts;
      if (p.key === undefined) return undefined;
      const { keyLead, keyTrail } = p.notes;
      if (indent === undefined) return `{ ${before(keyLead)}${p.key}${after(keyTrail)} }`;
      const inner = indent + style.indent;
      return `{\n${lines(keyLead, inner)}${inner}${p.key},${after(keyTrail)}\n${indent}}`;
    };

    /** The edits that rewrite `call`'s second argument `second` to `parts`, laid out as a formatter would. */
    const layout = (call: Node, topic: Node, second: Node, p: Parts): Edit[] => {
      const { notes } = p;
      const edits: Edit[] = [];
      if (notes.other.length > 0) {
        const at = lineStart(text, call.start);
        edits.push({ start: at, end: at, text: lines(notes.other, indentAt(text, call.start)) });
      }
      const all = [notes.valueLead, notes.valueTrail, notes.keyLead, notes.keyTrail].flat();
      const anyLine = all.some(isLine);
      const keyLine = [...notes.keyLead, ...notes.keyTrail].some(isLine);
      const valueNotes = notes.valueLead.length + notes.valueTrail.length > 0;
      const v = bare(p.value);

      // The call's parentheses, and what lies between the arguments.
      const typeArgs = child(call, 'typeArguments');
      const calleeEnd = typeArgs?.end ?? child(call, 'callee')?.end ?? call.start;
      const open = text.indexOf('(', calleeEnd);
      const close = call.end - 1;
      const clean =
        open !== -1 &&
        /^\s*(\?\.)?\s*$/.test(text.slice(calleeEnd, open)) &&
        text[close] === ')' &&
        /^\s*,?\s*$/.test(text.slice(second.end, close));
      const between = text.slice(open + 1, topic.start) + text.slice(topic.end, second.start);
      const plain = clean && commentsIn(between, 0, between.length, []).length === 0;

      const valueOne = !slice(p.value).includes('\n');
      const flatOpts = optsText(p);
      const flatArgs = `${slice(topic)}, ${before(notes.valueLead)}${slice(p.value)}${after(notes.valueTrail)}${flatOpts === undefined ? '' : `, ${flatOpts}`}`;
      const flat = (): Edit => ({ start: open + 1, end: close, text: flatArgs });
      const flatFits =
        plain &&
        !anyLine &&
        valueOne &&
        !slice(topic).includes('\n') &&
        width(
          text.slice(lineStart(text, open), open + 1) +
            flatArgs +
            text.slice(close, lineEnd(text, close)),
        ) <= style.printWidth;

      // A call on one line stays on one line.
      const oneLine = !text.slice(call.start, call.end).includes('\n');
      if (plain && !anyLine && (oneLine || (flatFits && all.length === 0))) {
        edits.push(flat());
        return edits;
      }

      const own = /^[ \t]*$/.test(text.slice(lineStart(text, second.start), second.start));
      const ind = indentAt(text, open);
      if (own) {
        // One argument per line already: the options get a line of their own.
        const at = indentAt(text, second.start);
        const opts = optsText(p, keyLine ? at : undefined);
        const lead = notes.valueLead.map((c) => `${c.text}\n${at}`).join('');
        const valueText = placed(p.value, at);
        const out =
          opts === undefined
            ? `${notes.valueTrail.map((c) => `${c.text}\n${at}`).join('')}${lead}${valueText}`
            : `${lead}${valueText},${after(notes.valueTrail)}\n${at}${opts}`;
        edits.push({ start: second.start, end: second.end, text: out });
        return edits;
      }

      if (clean) {
        const prefix = text.slice(lineStart(text, second.start), second.start);
        const huggable =
          v.type === 'ObjectExpression' ||
          v.type === 'ArrayExpression' ||
          v.type === 'ArrowFunctionExpression' ||
          v.type === 'FunctionExpression';
        // No options: an object or function value hugs the call as the record did.
        if (flatOpts === undefined && !valueNotes && huggable) {
          edits.push({ start: second.start, end: second.end, text: placed(p.value, ind) });
          return edits;
        }
        // `{ key }` last, after a value that isn't an object: the options hug the call.
        if (
          p.opts === undefined &&
          p.key !== undefined &&
          !valueNotes &&
          valueOne &&
          p.value.type !== 'ObjectExpression' &&
          width(`${prefix}${slice(p.value)}, {`) <= style.printWidth
        ) {
          edits.push({
            start: second.start,
            end: second.end,
            text: `${slice(p.value)}, ${optsText(p, ind) ?? ''}`,
          });
          return edits;
        }
        // Otherwise one argument per line.
        const at = ind + style.indent;
        const pre = text.slice(open + 1, topic.start).trim();
        const opts = optsText(p, keyLine ? at : undefined);
        const comma = style.trailingComma ? ',' : '';
        const head = `${pre === '' ? '' : `${at}${pre}\n`}${at}${placed(topic, at)}`;
        const value = `${lines(notes.valueLead, at)}${at}${placed(p.value, at)}`;
        const tail =
          opts === undefined
            ? `${comma}${after(notes.valueTrail)}`
            : `,${after(notes.valueTrail)}\n${at}${opts}${comma}`;
        edits.push({ start: open + 1, end: close, text: `\n${head},\n${value}${tail}\n${ind}` });
        return edits;
      }

      // An unusual call (comments around the parentheses): the old in-place rewrite.
      edits.push({
        start: second.start,
        end: second.end,
        text: `${lines(notes.valueLead, '')}${slice(p.value)}${flatOpts === undefined ? '' : `, ${flatOpts}`}`,
      });
      return edits;
    };

    /** The parts for a two-argument call's second argument, a flag, or nothing to do. */
    const partsOf = (second: Node): Parts | 'flag' | undefined => {
      const arg = bare(second);
      if (arg.type === 'ObjectExpression') {
        const r = recordOf(arg);
        if (r === undefined || r === 'flag') return r;
        const key =
          r.key === undefined ? undefined : r.keyShorthand ? 'key' : `key: ${slice(r.key)}`;
        return { value: r.value, key, opts: undefined, notes: notesOf(arg, r) };
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
          // A comment in either branch has nowhere clear to go.
          const commented = (o: Node, r: Rec): boolean => {
            const n = notesOf(o, r);
            return Object.values(n).some((cs: Comment[]) => cs.length > 0);
          };
          if (commented(yes, a) || commented(no, b)) return 'flag';
          const opt = (r: Rec): string =>
            r.key === undefined ? '{}' : r.keyShorthand ? '{ key }' : `{ key: ${slice(r.key)} }`;
          const opts =
            a.key === undefined && b.key === undefined
              ? undefined
              : `${slice(test)} ? ${opt(a)} : ${opt(b)}`;
          return { value: a.value, key: undefined, opts, notes: noNotes() };
        }
      }
      return recordLike(arg) ? 'flag' : undefined;
    };

    // Parents, for the member chain a rewritten call sits in.
    const parents = new Map<Node, Node>();
    walk(file.program, (node, parent) => {
      if (parent !== undefined) parents.set(node, parent);
    });

    /**
     * A member chain the rewrite made short enough for one line
     * (`k\n  .publish(…)\n  .then(…)`): the edit that joins it, when it has at
     * most two calls, breaks only before its `.`s and fits.
     */
    const joined = (call: Node, edit: Edit): Edit | undefined => {
      let top = call;
      for (;;) {
        const up = parents.get(top);
        if (up?.type === 'MemberExpression' && child(up, 'object') === top) top = up;
        else if (up?.type === 'CallExpression' && child(up, 'callee') === top) top = up;
        else break;
      }
      let calls = 0;
      for (let n: Node | undefined = top; n !== undefined;) {
        if (n.type === 'CallExpression') {
          calls++;
          n = child(n, 'callee');
        } else if (n.type === 'MemberExpression') n = child(n, 'object');
        else n = undefined;
      }
      const rest = text.slice(top.start, edit.start) + text.slice(edit.end, top.end);
      // Another `publish` in the chain may get its own edit, which would overlap.
      if (calls > 2 || rest.split('publish').length > 2) return undefined;
      const chain = text.slice(top.start, edit.start) + edit.text + text.slice(edit.end, top.end);
      if (!chain.includes('\n') || !/^(?:[^\n]*\n\s*\??\.)*[^\n]*$/.test(chain)) return undefined;
      const one = chain.replace(/\s*\n\s*(?=\??\.)/g, '');
      const line =
        text.slice(lineStart(text, top.start), top.start) +
        one +
        text.slice(top.end, lineEnd(text, top.end));
      if (width(line) > style.printWidth) return undefined;
      return { start: top.start, end: top.end, text: one };
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
      const [topic, second] = args;
      if (args.length !== 2 || topic === undefined || second === undefined) return;
      const parts = partsOf(second);
      if (parts === undefined) return;
      // A receiver it can't name gets the flag where Isoloop's would be rewritten.
      if (parts === 'flag' || who === 'unknown') {
        flags.push({ at: node.start, message: FLAG });
        return;
      }
      const out = layout(node, topic, second, parts);
      const last = out.at(-1);
      const chain =
        last !== undefined && !last.text.includes('\n') ? joined(node, last) : undefined;
      edits.push(...(chain === undefined ? out : [...out.slice(0, -1), chain]));
    });
    return { edits, flags };
  },
};
