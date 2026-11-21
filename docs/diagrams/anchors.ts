// The diagrams' citations follow the code on main (README, "Keeping them
// true"). Each one carries `anchor`: the text of its first cited line that
// occurs once in its file, `anchor_offset` lines into the range when that isn't
// its first line. diagrams.test.ts fails when an anchor isn't on its line.
//
//   node docs/diagrams/anchors.ts         lists the citations that drifted
//   node docs/diagrams/anchors.ts --fix   finds them again and rewrites the JSON
//
// `--fix` finds a moved file by its name in the same package (ADR 0021 keeps
// file names on a move), then the anchor's one line in it, and shifts the
// range to match. One it can't find is left for a person: the cited code
// changed, so the diagram may need redrawing.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';

export type Citation = {
  path: string;
  line: number;
  end_line?: number;
  label?: string;
  anchor?: string;
  anchor_offset?: number;
};

/** Reads a repo-relative path, or `undefined` when there's no such file. */
export type Read = (path: string) => string | undefined;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asCitation = (o: Record<string, unknown>): Citation | undefined => {
  const { path, line, end_line: endLine, label, anchor, anchor_offset: offset } = o;
  if (typeof path !== 'string' || typeof line !== 'number') return undefined;
  return {
    path,
    line,
    ...(typeof endLine === 'number' ? { end_line: endLine } : {}),
    ...(typeof label === 'string' ? { label } : {}),
    ...(typeof anchor === 'string' ? { anchor } : {}),
    ...(typeof offset === 'number' ? { anchor_offset: offset } : {}),
  };
};

/** Every citation in a diagram, in document order. */
export function citations(diagram: unknown): Citation[] {
  const out: Citation[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) walk(x);
    else if (isRecord(v)) {
      const c = asCitation(v);
      if (c) out.push(c);
      else for (const x of Object.values(v)) walk(x);
    }
  };
  walk(diagram);
  return out;
}

/** What's wrong with a citation, or `undefined` when its anchor is on its line. */
export function problemOf(c: Citation, read: Read): string | undefined {
  if (c.anchor === undefined) return `${c.path}:${c.line} has no anchor`;
  const text = read(c.path);
  if (text === undefined) return `${c.path} doesn't exist`;
  const lines = text.split('\n');
  const end = c.end_line ?? c.line;
  if (c.line < 1 || end < c.line || end > lines.length)
    return `lines ${c.line}-${end} aren't all in ${c.path}`;
  const at = c.line + (c.anchor_offset ?? 0);
  if (at > end) return `${c.path}:${c.line}: anchor_offset is past end_line`;
  return (lines[at - 1] ?? '').trim() === c.anchor
    ? undefined
    : `line ${at} of ${c.path} isn't "${c.anchor}"`;
}

/**
 * The citation found again, or `undefined`: its file (by name in the same
 * package when it moved), then the one line that holds its anchor.
 */
export function relocate(c: Citation, read: Read, files: readonly string[]): Citation | undefined {
  if (c.anchor === undefined) return undefined;
  let path = c.path;
  if (read(path) === undefined) {
    const pkg = /^packages\/[^/]+\//.exec(path)?.[0];
    const same = files.filter(
      (f) => pkg !== undefined && f.startsWith(pkg) && basename(f) === basename(path),
    );
    if (same.length !== 1 || same[0] === undefined) return undefined;
    path = same[0];
  }
  const lines = (read(path) ?? '').split('\n').map((l) => l.trim());
  const hits = lines.flatMap((l, i) => (l === c.anchor ? [i + 1] : []));
  if (hits.length !== 1 || hits[0] === undefined) return undefined;
  const line = hits[0] - (c.anchor_offset ?? 0);
  const out: Citation = { ...c, path, line };
  if (c.end_line !== undefined) out.end_line = c.end_line + (line - c.line);
  return out;
}

/** A diagram's JSON text with its citations' path, line and end_line replaced, in order, keeping its formatting. */
export function rewrite(text: string, cites: readonly Citation[]): string {
  let n = 0;
  const out = text.replace(
    /("path":\s*)"[^"]*"(,\s*"line":\s*)\d+(?:(,\s*"end_line":\s*)\d+)?/g,
    (_m, path: string, line: string, end: string | undefined) => {
      const c = cites[n++];
      if (!c) throw new Error('more citations in the text than in the JSON');
      const e = end !== undefined && c.end_line !== undefined ? `${end}${c.end_line}` : '';
      return `${path}${JSON.stringify(c.path)}${line}${c.line}${e}`;
    },
  );
  if (n !== cites.length) throw new Error(`${n} citations rewritten of ${cites.length}`);
  return out;
}

// --- Running it ----------------------------------------------------------------

const SKIP = new Set(['node_modules', 'dist']);

function sourceFiles(root: string, rel: string): string[] {
  return readdirSync(join(root, rel)).flatMap((name) => {
    if (name.startsWith('.') || SKIP.has(name)) return [];
    const p = posix.join(rel, name);
    return statSync(join(root, p)).isDirectory() ? sourceFiles(root, p) : [p];
  });
}

function main(): void {
  const root = join(import.meta.dirname, '../..');
  const fix = process.argv.includes('--fix');
  const read: Read = (p) => {
    try {
      return readFileSync(join(root, p), 'utf8');
    } catch {
      return undefined;
    }
  };
  const files = sourceFiles(root, 'packages');
  const dir = join(root, 'docs/diagrams');
  let left = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const text = readFileSync(join(dir, name), 'utf8');
    const cites = citations(JSON.parse(text));
    let changed = false;
    const next = cites.map((c) => {
      const problem = problemOf(c, read);
      if (problem === undefined) return c;
      const found = fix ? relocate(c, read, files) : undefined;
      if (found && problemOf(found, read) === undefined) {
        changed = true;
        console.log(`fixed   ${name}: ${c.path}:${c.line} -> ${found.path}:${found.line}`);
        return found;
      }
      left++;
      console.log(`${fix ? 'left   ' : 'drifted'} ${name}: ${problem} [${c.label ?? ''}]`);
      return c;
    });
    if (changed) writeFileSync(join(dir, name), rewrite(text, next));
  }
  if (left > 0) {
    console.log(
      fix
        ? `${left} citation(s) need a person: the cited code changed`
        : `${left} citation(s) drifted; run with --fix`,
    );
    process.exitCode = 1;
  } else console.log('every citation is on its anchor');
}

if (import.meta.main) main();
