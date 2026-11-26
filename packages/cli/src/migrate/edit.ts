/*
 * Text edits for `isoloop migrate`: a step says which source ranges to
 * replace, and the text around them is left exactly as it was, so a user's
 * formatting and comments survive. Our own, beside the parser interface
 * (ADR 0019, decision 10).
 */

/** Replace `text.slice(start, end)` with `text`. `start === end` inserts. */
export type Edit = { readonly start: number; readonly end: number; readonly text: string };

/** A place a step can't rewrite safely: a `// isoloop-migrate:` comment goes on the line above. */
export type Flag = { readonly at: number; readonly message: string };

/** What a step gives for one file. */
export type Change = { readonly edits: readonly Edit[]; readonly flags: readonly Flag[] };

/** The comment's prefix, which users search for. */
export const FLAG_PREFIX = '// isoloop-migrate:';

/** Two edits overlap, so applying both would be ambiguous. */
export class EditConflict extends Error {
  override readonly name: string = 'EditConflict';
}

/** The start of the line `at` is on. */
const lineStart = (text: string, at: number): number => text.lastIndexOf('\n', at - 1) + 1;

/**
 * The edits that insert one `// isoloop-migrate: <message>` line above each
 * flag's line, indented like it. A flag whose line already has the same
 * comment above it adds nothing, so a second run leaves the file alone.
 * Several flags on one line give one comment each, in order. The comment
 * ends with the file's own line ending.
 */
export function flagEdits(text: string, flags: readonly Flag[]): Edit[] {
  const out: Edit[] = [];
  const seen = new Set<string>();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  for (const f of flags) {
    const start = lineStart(text, f.at);
    const indent = /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
    const comment = `${indent}${FLAG_PREFIX} ${f.message}`;
    const key = `${start}\n${comment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // The comments already directly above the line.
    let above = start;
    let present = false;
    while (above > 0) {
      const prev = lineStart(text, above - 1);
      const line = text.slice(prev, above - 1).replace(/\r$/, '');
      if (!line.trimStart().startsWith(FLAG_PREFIX)) break;
      if (line === comment) present = true;
      above = prev;
    }
    if (!present) out.push({ start, end: start, text: `${comment}${eol}` });
  }
  return out;
}

/**
 * Applies `edits` to `text`. Inserts at the same offset keep their order.
 * Throws {@link EditConflict} when two edits overlap, or one is out of range.
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  const sorted = edits
    .map((e, i) => ({ e, i }))
    .toSorted((a, b) => a.e.start - b.e.start || a.e.end - b.e.end || a.i - b.i)
    .map(({ e }) => e);
  let out = '';
  let at = 0;
  for (const e of sorted) {
    if (e.start < 0 || e.end > text.length || e.start > e.end) {
      throw new EditConflict(`edit ${e.start}–${e.end} is outside the file (0–${text.length})`);
    }
    if (e.start < at) throw new EditConflict(`edits overlap at offset ${e.start}`);
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}

/** A step's change applied to `text`: its edits, then a comment above each flagged line. */
export function applyChange(text: string, change: Change): string {
  return applyEdits(text, [...change.edits, ...flagEdits(text, change.flags)]);
}

/**
 * Where offset `at` of the old text is once `edits` are applied. An insert
 * at `at` goes before it; an edit that replaces `at` maps it to the start of
 * its new text.
 */
export function mapOffset(at: number, edits: readonly Edit[]): number {
  let shift = 0;
  let inside: number | undefined;
  for (const e of edits) {
    if (e.end <= at) shift += e.text.length - (e.end - e.start);
    else if (e.start < at) inside = e.start;
  }
  if (inside === undefined) return at + shift;
  let before = 0;
  for (const e of edits) if (e.end <= inside) before += e.text.length - (e.end - e.start);
  return inside + before;
}
