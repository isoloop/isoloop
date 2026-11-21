// CI: when a PR changes the public API of a published package, it also
// documents it (isoloop/web ADR 0004, decision 4). Builds every package on the
// PR and on its merge base, and compares the published declarations
// (`dist/**/*.d.ts`, written by tsdown from `isolatedDeclarations`):
// - normalised: comments and formatting ignored, chunk hashes ignored, export
//   lists sorted, declarations marked `@internal` left out;
// - compared per package by exported names and their declarations (ADR 0021,
//   decision 8): `export type X = …` reads the same as `type X = …` with
//   `export { X }`, `type` modifiers in lists don't count, and an `@internal`
//   name goes out of the lists with its declaration.
// A changed package needs (a) a changeset bumping it at least `minor`,
// (b) a change under docs/ or to TSDoc in its src/, and (c) a "Site impact:"
// other than `none`. The changed declarations go to the job summary.
//
// It also compares the dist JS, without tsdown's `// src/<path>` comments.
// When a package's JS changed and no changeset in the PR bumps it, the summary
// says so: a notice, not a failure, since a refactor may change output on
// purpose. A move that keeps file names changes nothing there.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { checkRemovedNames } from '../docs/markdown.ts';
import { parseSiteImpact } from './site-impact-parse.ts';
import { prBody } from './site-impact.ts';

const sh = (cwd: string, cmd: string, args: string[]): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 28,
  });

/** After a closing brace, the statement goes on (`} from`, `} | X`, `}[]`…). */
const CONTINUES = /^\s*(?:[|&=;,.)\]>[]|from\b|as\b|extends\b|implements\b)/;

/** Removes each declaration or member whose doc comment says `@internal`. */
export function dropInternal(src: string): string {
  let out = src;
  for (;;) {
    const m = /\/\*\*(?:(?!\*\/)[\s\S])*@internal[\s\S]*?\*\//.exec(out);
    if (!m) return out;
    const end = itemEnd(out, m.index + m[0].length);
    out = out.slice(0, m.index) + out.slice(end);
  }
}

/**
 * End of the item starting at `from`: after `;` or `,` at depth 0, or after a
 * block that closes at depth 0. Type arguments (`Envelope<'a', P>`) count as
 * depth, so their commas don't end the item; the `>` of `=>` doesn't.
 */
function itemEnd(s: string, from: number): number {
  let depth = 0;
  let angles = 0;
  let opened = false;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (s.startsWith('/*', i)) {
      const close = s.indexOf('*/', i + 2);
      i = close < 0 ? s.length : close + 1;
    } else if (s.startsWith('//', i)) {
      const close = s.indexOf('\n', i);
      i = close < 0 ? s.length : close;
    } else if (c === '"' || c === "'" || c === '`') {
      const close = s.indexOf(c, i + 1);
      i = close < 0 ? s.length : close;
    } else if (c === '{' || c === '(' || c === '[') {
      depth++;
      if (c === '{') opened = true;
    } else if (c === '<') {
      angles++;
    } else if (c === '>' && s[i - 1] !== '=') {
      if (angles > 0) angles--;
    } else if (c === '}' || c === ')' || c === ']') {
      if (depth === 0) return i;
      depth--;
      if (depth === 0 && c === '}' && opened && !CONTINUES.test(s.slice(i + 1))) {
        const semi = /^\s*;/.exec(s.slice(i + 1));
        return i + 1 + (semi ? semi[0].length : 0);
      }
    } else if ((c === ';' || c === ',') && depth === 0 && angles === 0) {
      return i + 1;
    }
  }
  return s.length;
}

/**
 * An import or export list, sorted, with tsdown's minified chunk aliases
 * dropped (`i as DomRecord` and `DomRecord as i` are both `DomRecord`): the
 * letters shift whenever a shared chunk changes, which isn't an API change.
 */
function names(list: string): string {
  const minified = /^[a-z]{1,2}$/;
  const out = list
    .split(',')
    .map((item) => {
      const [left = '', right] = item.trim().split(/\s*\bas\b\s*/);
      if (right === undefined) return left;
      if (minified.test(left)) return right;
      if (minified.test(right)) return left;
      return `${left} as ${right}`;
    })
    .filter(Boolean);
  out.sort();
  return out.join(',');
}

/** Top-level statements of a declaration file, normalised for comparison. */
export function statements(src: string): string[] {
  const text = dropInternal(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, '$1')
    // tsdown names shared chunks `name-<8 char hash>`: the hash isn't API.
    .replace(/-[A-Za-z0-9_-]{8}(\.(?:d\.)?[mc]?[jt]s)/g, '-#$1');
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const close = text.indexOf(c, i + 1);
      i = close < 0 ? text.length : close;
    } else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    if (depth === 0 && (c === ';' || (c === '}' && !CONTINUES.test(text.slice(i + 1))))) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out
    .map((s) =>
      s
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}()[\];,:<>=|&?])\s*/g, '$1')
        .trim(),
    )
    .map((s) =>
      s.replace(
        /^((?:export|import)(?: type)?)\{([^}]*)\}/,
        (_, kw: string, list: string) => `${kw}{${names(list)}}`,
      ),
    )
    .filter((s) => s !== '' && s !== ';' && s !== 'export{}');
}

/**
 * The names a package's normalised statements export: `export{a,b as c}`
 * lists (the exported side of `as`) and `export` declarations.
 */
export function exportedNames(stmts: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const s of stmts) {
    const list = /^export(?: type)?\{([^}]*)\}/.exec(s);
    if (list) {
      for (const item of (list[1] ?? '').split(',')) {
        const name = item
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.replace(/^type\s+/, '');
        if (name && name !== 'default') out.add(name);
      }
      continue;
    }
    const decl =
      /^export (?:declare )?(?:abstract )?(?:function|const|let|class|interface|type|enum|namespace)\s*([A-Za-z_$][\w$]*)/.exec(
        s,
      );
    if (decl?.[1]) out.add(decl[1]);
  }
  return out;
}

const DECLARATION =
  /^(?:abstract )?(?:function|const|let|class|interface|type|enum|namespace)\s*([A-Za-z_$][\w$]*)/;

/** The top-level names a declaration file marks `@internal`: the declarations `dropInternal` removes. */
export function internalNames(src: string): Set<string> {
  const out = new Set<string>();
  const re =
    /\/\*\*(?:(?!\*\/)[\s\S])*?@internal[\s\S]*?\*\/\s*(?:export\s+)?(?:declare\s+)?((?:abstract\s+)?(?:function|const|let|class|interface|type|enum|namespace)\s+[A-Za-z_$][\w$]*)/g;
  for (const m of src.matchAll(re)) {
    const name = DECLARATION.exec((m[1] ?? '').replace(/\s+/g, ' '))?.[1];
    if (name) out.add(name);
  }
  return out;
}

/**
 * A package's declaration files as a set of normalised statements in which only
 * exported names and their declarations count. Declarations lose `export` and
 * `declare`, and each file's exported names become one sorted `export{…}`, so a
 * list and an exported declaration read the same. `type` modifiers in lists
 * don't count, and `@internal` names leave the lists along with their
 * declarations.
 */
export function surfaceOf(files: readonly string[]): Set<string> {
  const internal = new Set(files.flatMap((f) => [...internalNames(f)]));
  const keep = (item: string): string | undefined => {
    const bare = item.trim().replace(/^type /, '');
    const [left = '', right] = bare.split(/ as /);
    return bare === '' || internal.has(left) || (right !== undefined && internal.has(right))
      ? undefined
      : bare;
  };
  const out = new Set<string>();
  for (const src of files) {
    const exported = new Set<string>();
    for (const s of statements(src)) {
      const list = /^(export|import)(?: type)?\{([^}]*)\}(from ?['"][^'"]*['"])?;?$/.exec(s);
      if (list) {
        const [, kw = '', items = '', from = ''] = list;
        const kept = items.split(',').flatMap((i) => keep(i) ?? []);
        if (kw === 'export' && from === '') for (const k of kept) exported.add(k);
        else if (kept.length > 0) {
          kept.sort();
          out.add(`${kw}{${kept.join(',')}}${from};`);
        }
        continue;
      }
      if (s.startsWith('export default')) {
        out.add(s);
        continue;
      }
      const body = s.replace(/^export /, '').replace(/^declare /, '');
      const name = DECLARATION.exec(body)?.[1];
      if (name === undefined) {
        out.add(s);
        continue;
      }
      out.add(body);
      if (s.startsWith('export ') && !internal.has(name)) exported.add(name);
    }
    if (exported.size > 0) {
      const list = [...exported];
      list.sort();
      out.add(`export{${list.join(',')}}`);
    }
  }
  return out;
}

/** Dist JS without tsdown's module comments (`// src/<path>`, `// ../protocol/dist/index.js`) or chunk hashes. */
export function normaliseJs(text: string): string {
  return text
    .replace(/^\/\/ \S+\.(?:[cm]?[jt]sx?|json)$\n?/gm, '')
    .replace(/-[A-Za-z0-9_-]{8}(\.(?:d\.)?[mc]?[jt]s)/g, '-#$1');
}

/** The files of two builds of one package that differ once normalised (chunk hashes dropped from their names). */
export function changedJs(
  before: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
): string[] {
  const files = new Set([...before.keys(), ...now.keys()]);
  const out = [...files].filter((n) => before.get(n) !== now.get(n));
  out.sort();
  return out;
}

function allNames(m: Map<string, Set<string>>): Set<string> {
  const out = new Set<string>();
  for (const stmts of m.values()) for (const n of exportedNames(stmts)) out.add(n);
  return out;
}

/** Names some package exported before and no package exports now. */
export function removedNames(
  before: Map<string, Set<string>>,
  now: Map<string, Set<string>>,
): Set<string> {
  const still = allNames(now);
  return new Set([...allNames(before)].filter((n) => !still.has(n)));
}

/** The `name` and `private` fields of a package.json. */
function readPackage(file: string): { name: string; private: boolean } {
  const pkg: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const get = (k: string): unknown =>
    typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, k) : undefined;
  const name = get('name');
  return { name: typeof name === 'string' ? name : file, private: get('private') === true };
}

const mark = (ok: boolean): string => (ok ? '✅' : '❌');

/** Every guide's mentions of `names`, as docs:check item 5 problems. */
function guidesNaming(root: string, gone: Set<string>): { file: string; message: string }[] {
  if (gone.size === 0) return [];
  const dir = join(root, 'docs/guide');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .flatMap((f) => checkRemovedNames(`docs/guide/${f}`, readFileSync(join(dir, f), 'utf8'), gone));
}

function distFiles(dir: string, match: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? distFiles(p, match) : match.test(name) ? [p] : [];
  });
}

/** Published package name → its directory under `packages/`. */
function published(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of readdirSync(join(root, 'packages'))) {
    const pkgFile = join(root, 'packages', dir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const pkg = readPackage(pkgFile);
    if (!pkg.private) out.set(pkg.name, join(root, 'packages', dir));
  }
  return out;
}

/** Published package name → its normalised declarations (`surfaceOf`). */
function surface(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [name, dir] of published(root)) {
    const files = distFiles(join(dir, 'dist'), /\.d\.[mc]?ts$/);
    out.set(name, surfaceOf(files.map((f) => readFileSync(f, 'utf8'))));
  }
  return out;
}

/** Published package name → its dist JS by file, normalised (`normaliseJs`). */
function distJs(root: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [name, dir] of published(root)) {
    const files = new Map<string, string>();
    for (const f of distFiles(join(dir, 'dist'), /\.[mc]?js$/)) {
      const key = normaliseJs(relative(join(dir, 'dist'), f));
      files.set(key, normaliseJs(readFileSync(f, 'utf8')));
    }
    out.set(name, files);
  }
  return out;
}

/** Packages whose dist JS changed with no changeset in the PR bumping them, and the files. */
export function unannouncedJs(
  before: ReadonlyMap<string, ReadonlyMap<string, string>>,
  now: ReadonlyMap<string, ReadonlyMap<string, string>>,
  bumped: ReadonlyMap<string, string>,
): { name: string; files: string[] }[] {
  return [...now]
    .filter(([name]) => !bumped.has(name))
    .map(([name, files]) => ({ name, files: changedJs(before.get(name) ?? new Map(), files) }))
    .filter((c) => c.files.length > 0);
}

function build(root: string): void {
  sh(root, 'pnpm', ['install', '--frozen-lockfile', '--prefer-offline']);
  sh(root, 'pnpm', ['-r', '--filter', './packages/*', 'build']);
}

/** Packages a changeset added in this PR bumps, with the strongest bump each. */
function bumps(root: string, base: string): Map<string, string> {
  const rank: Record<string, number> = { patch: 1, minor: 2, major: 3 };
  const out = new Map<string, string>();
  const files = sh(root, 'git', [
    'diff',
    '--name-only',
    '--diff-filter=AM',
    base,
    'HEAD',
    '--',
    '.changeset',
  ])
    .split('\n')
    .filter((f) => /\.md$/i.test(f) && !/README/i.test(f));
  for (const f of files) {
    const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(root, f), 'utf8'))?.[1] ?? '';
    for (const m of front.matchAll(
      /^\s*['"]?(@isoloop\/[\w-]+)['"]?\s*:\s*(patch|minor|major)\s*$/gm,
    )) {
      const [, name = '', level = ''] = m;
      if ((rank[level] ?? 0) > (rank[out.get(name) ?? ''] ?? 0)) out.set(name, level);
    }
  }
  return out;
}

/** True when the PR touches docs/ or adds TSDoc lines in the package's src/. */
function documented(root: string, base: string, pkgDir: string): boolean {
  const changed = sh(root, 'git', ['diff', '--name-only', base, 'HEAD']).split('\n');
  if (changed.some((f) => f.startsWith('docs/'))) return true;
  const diff = sh(root, 'git', ['diff', '-U0', base, 'HEAD', '--', `${pkgDir}/src`]);
  return diff.split('\n').some((l) => /^\+(?!\+\+)\s*(\/\*\*|\*(?!\/))/.test(l));
}

function main(): void {
  const root = process.cwd();
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  const say = (t: string): void => {
    console.log(t);
    if (summaryFile) appendFileSync(summaryFile, `${t}\n`);
  };
  const baseRef = process.env['BASE_SHA'] ?? 'origin/main';
  const base = sh(root, 'git', ['merge-base', baseRef, 'HEAD']).trim();
  const touched = sh(root, 'git', ['diff', '--name-only', base, 'HEAD', '--', 'packages'])
    .split('\n')
    .filter(
      (f) => /^packages\/[^/]+\/src\//.test(f) && !/\.(test|spec|browser\.test)\.[jt]sx?$/.test(f),
    );
  if (touched.length === 0) {
    say('## API check\n\nNo package source changed: nothing to compare.');
    return;
  }

  build(root);
  const head = surface(root);
  const headJs = distJs(root);
  const baseDir = mkdtempSync(join(tmpdir(), 'api-base-'));
  sh(root, 'git', ['worktree', 'add', '--detach', baseDir, base]);
  try {
    build(baseDir);
    const before = surface(baseDir);
    const beforeJs = distJs(baseDir);
    const bumped = bumps(root, base);
    const dirs = new Map<string, string>();
    for (const dir of readdirSync(join(root, 'packages'))) {
      const f = join(root, 'packages', dir, 'package.json');
      if (existsSync(f)) dirs.set(readPackage(f).name, relative(root, join(root, 'packages', dir)));
    }

    // The JS notice (ADR 0021, decision 8): output that changed with no changeset.
    const quiet = unannouncedJs(beforeJs, headJs, bumped);
    const jsNotice = (): void => {
      if (quiet.length === 0) return;
      say('\n### Changed output without a changeset\n');
      say(
        "The dist JS of these packages changed beyond tsdown's source-path comments, and no changeset in this PR bumps them. A refactor may do that on purpose; a change users can see needs a changeset.\n",
      );
      for (const q of quiet) say(`- \`${q.name}\`: ${q.files.map((f) => `\`${f}\``).join(', ')}`);
      console.log(
        `::notice title=API check::dist JS changed without a changeset: ${quiet.map((q) => q.name).join(', ')}`,
      );
    };

    const changes: { name: string; added: string[]; removed: string[] }[] = [];
    for (const [name, now] of head) {
      const was = before.get(name) ?? new Set<string>();
      const added = [...now].filter((s) => !was.has(s));
      const removed = [...was].filter((s) => !now.has(s));
      if (added.length || removed.length) changes.push({ name, added, removed });
    }
    if (changes.length === 0) {
      say('## API check\n\nThe published declarations are unchanged.');
      jsNotice();
      return;
    }

    // docs:check item 5 (M4c, decision 22): a guide naming a removed export.
    const gone = removedNames(before, head);
    const stale = guidesNaming(root, gone);

    const impact = parseSiteImpact(prBody());
    let failed = false;
    say('## API check\n\nThe public API changed:');
    for (const c of changes) {
      const level = bumped.get(c.name);
      const okBump = level === 'minor' || level === 'major';
      const okDocs = documented(root, base, dirs.get(c.name) ?? '');
      const okImpact = impact.ok && impact.value !== 'none';
      failed ||= !okBump || !okDocs || !okImpact;
      say(`\n### \`${c.name}\`\n`);
      say(
        `- ${mark(okBump)} a changeset bumping it at least \`minor\` (found: ${level ?? 'none'})`,
      );
      say(`- ${mark(okDocs)} a change under \`docs/\` or to TSDoc in its \`src/\``);
      say(
        `- ${mark(okImpact)} \`Site impact:\` other than \`none\` (found: ${impact.ok ? impact.value : 'missing or invalid'})`,
      );
      say('\n```diff');
      for (const s of c.removed) say(`- ${s}`);
      for (const s of c.added) say(`+ ${s}`);
      say('```');
    }
    jsNotice();
    if (stale.length > 0) {
      failed = true;
      say('\n### Guides that name a removed export\n');
      for (const p of stale) {
        say(`- ❌ \`${p.file}\`: ${p.message}`);
        console.error(`::error file=${p.file.replace(/:\d+$/, '')}::${p.message}`);
      }
    }
    if (failed) {
      say("\nMark an export `@internal` in its TSDoc if it isn't meant to be public.");
      console.error(
        '::error title=API check::The public API changed without a minor changeset, docs, or a Site impact. See the job summary.',
      );
      process.exitCode = 1;
    }
  } finally {
    sh(root, 'git', ['worktree', 'remove', '--force', baseDir]);
  }
}

if (import.meta.main) main();
