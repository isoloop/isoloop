/*
 * What `isoloop migrate` does to a folder: finds the source files, runs
 * each step on each file in order, and returns the before and after text.
 * It writes nothing itself; the command decides (dry run or `--write`).
 */
import { join, relative, sep } from 'node:path';
import type { Io } from '../program/io';
import { applyEdits, flagEdits, mapOffset, type Edit } from './edit';
import { EXTENSIONS, type Parser } from './parser';
import type { Step } from './step';

/** A flagged place in a migrated file: the line of the code under the comment, 1-based. */
export type Flagged = { readonly line: number; readonly message: string };

export type FileResult = {
  /** Relative to the folder migrated, with `/` separators. */
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly flags: readonly Flagged[];
};

export type RunResult = {
  /** The files a step changed, in path order. */
  readonly changed: readonly FileResult[];
  /** Files that didn't parse, left as they were. */
  readonly failed: readonly { readonly path: string; readonly message: string }[];
  /** How many source files were read. */
  readonly scanned: number;
};

/** Folders never walked into: installed packages and dot-folders (`.git`, `.next`…). */
const skipDir = (name: string): boolean => name === 'node_modules' || name.startsWith('.');

const isSource = (name: string): boolean =>
  EXTENSIONS.some((ext) => name.endsWith(ext)) && !/\.d\.[cm]?ts$/.test(name);

/** Every source file under `root`, sorted, as absolute paths. */
async function sources(io: Io, root: string): Promise<string[]> {
  const out: string[] = [];
  const dirs = [root];
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir === undefined) break;
    // oxlint-disable-next-line no-await-in-loop -- a breadth of folders, one listing at a time
    const entries = (await io.list(dir)) ?? [];
    for (const e of entries) {
      if (e.kind === 'dir' && !skipDir(e.name)) dirs.push(join(dir, e.name));
      else if (e.kind === 'file' && isSource(e.name)) out.push(join(dir, e.name));
    }
  }
  return out.toSorted();
}

/** The 1-based line that offset `at` is on. */
const lineOf = (text: string, at: number): number => {
  let line = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) line++;
  return line;
};

/** Runs `steps` on every source file under `root`. `parser` is loaded only if a step needs it. */
export async function migrateFolder(input: {
  io: Io;
  root: string;
  steps: readonly Step[];
  parser: () => Promise<Parser>;
}): Promise<RunResult> {
  const { io, root, steps } = input;
  let parser: Parser | undefined;
  const changed: FileResult[] = [];
  const failed: { path: string; message: string }[] = [];
  const files = await sources(io, root);
  for (const abs of files) {
    const path = relative(root, abs).split(sep).join('/');
    // oxlint-disable-next-line no-await-in-loop -- one file at a time keeps memory flat
    const before = (await io.readFile(abs)) ?? '';
    let text = before;
    let flags: { at: number; message: string }[] = [];
    let error: string | undefined;
    for (const step of steps) {
      if (!step.mayChange(text)) continue;
      // oxlint-disable-next-line no-await-in-loop -- loaded once, on the first file that needs it
      parser ??= await input.parser();
      const parsed = parser.parse(abs, text);
      if (!parsed.ok) {
        const e = parsed.errors[0];
        error = `line ${lineOf(text, e?.start ?? 0)}: ${e?.message ?? 'syntax error'}`;
        break;
      }
      const change = step.transform(parsed.file);
      const edits: Edit[] = [...change.edits, ...flagEdits(text, change.flags)];
      // Earlier steps' flags move with this step's edits.
      flags = [...flags, ...change.flags].map((f) => ({
        at: mapOffset(f.at, edits),
        message: f.message,
      }));
      text = applyEdits(text, edits);
    }
    if (error !== undefined) {
      failed.push({ path, message: error });
      continue;
    }
    if (text === before) continue;
    changed.push({
      path,
      before,
      after: text,
      flags: flags.map((f) => ({ line: lineOf(text, f.at), message: f.message })),
    });
  }
  return { changed, failed, scanned: files.length };
}
