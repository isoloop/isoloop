/*
 * A unified diff of two texts, for `isoloop migrate`'s dry run. Our own:
 * Myers' line diff with three lines of context, in the format `git apply`
 * and `patch` read.
 */

type Op = { readonly kind: ' ' | '-' | '+'; readonly line: string };

/** The text's lines, each without its `\n`, and whether the last one had one. */
function lines(text: string): { lines: string[]; endsWithNewline: boolean } {
  if (text === '') return { lines: [], endsWithNewline: true };
  const endsWithNewline = text.endsWith('\n');
  const all = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
  return { lines: all, endsWithNewline };
}

/** The shortest edit script from `a` to `b` (Myers, 1986). */
function script(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
    if (found >= 0) break;
  }
  // Walk back through the trace.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d] ?? new Int32Array(0);
    const k = x - y;
    const down = k === -d || (k !== d && (prev[offset + k - 1] ?? 0) < (prev[offset + k + 1] ?? 0));
    const pk = down ? k + 1 : k - 1;
    const px = prev[offset + pk] ?? 0;
    const py = px - pk;
    while (x > px + (down ? 0 : 1) && y > py + (down ? 1 : 0)) {
      ops.push({ kind: ' ', line: a[--x] ?? '' });
      y--;
    }
    if (down) ops.push({ kind: '+', line: b[--y] ?? '' });
    else ops.push({ kind: '-', line: a[--x] ?? '' });
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: ' ', line: a[--x] ?? '' });
    y--;
  }
  return ops.toReversed();
}

const CONTEXT = 3;
const NO_NEWLINE = '\\ No newline at end of file';

/**
 * The lines with a missing final newline marked on the last one, so a
 * change to the final newline alone shows as a change.
 */
const marked = (l: { lines: string[]; endsWithNewline: boolean }): string[] =>
  l.endsWithNewline || l.lines.length === 0
    ? l.lines
    : [...l.lines.slice(0, -1), `${l.lines.at(-1) ?? ''}\n${NO_NEWLINE}`];

const range = (start: number, count: number): string =>
  count === 1 ? `${start}` : `${count === 0 ? start - 1 : start},${count}`;

/**
 * The unified diff from `before` to `after`, headed `--- a/<path>` and
 * `+++ b/<path>`. Empty when the texts are equal.
 */
export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return '';
  const a = lines(before);
  const b = lines(after);
  const ops = script(marked(a), marked(b));

  // Group the changed ops into hunks with CONTEXT lines around them.
  const changed = ops.flatMap((o, i) => (o.kind === ' ' ? [] : [i]));
  const hunks: { from: number; to: number }[] = [];
  for (const i of changed) {
    const last = hunks.at(-1);
    if (last !== undefined && i - last.to <= 2 * CONTEXT) last.to = i;
    else hunks.push({ from: i, to: i });
  }

  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const from = Math.max(0, h.from - CONTEXT);
    const to = Math.min(ops.length - 1, h.to + CONTEXT);
    // Line numbers where the hunk starts, counted from the ops before it.
    let aStart = 1;
    let bStart = 1;
    for (let i = 0; i < from; i++) {
      const o = ops[i];
      if (o?.kind !== '+') aStart++;
      if (o?.kind !== '-') bStart++;
    }
    const body = ops.slice(from, to + 1);
    const aCount = body.filter((o) => o.kind !== '+').length;
    const bCount = body.filter((o) => o.kind !== '-').length;
    out.push(`@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@`);
    for (const o of body) out.push(`${o.kind}${o.line}`);
  }
  return `${out.join('\n')}\n`;
}
