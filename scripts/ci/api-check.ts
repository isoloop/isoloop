// CI: when a PR changes the public API of a published package, it also
// documents it (isoloop/web ADR 0004, decision 4). Builds every package on the
// PR and on its merge base, and compares the published declarations
// (`dist/**/*.d.ts`, written by tsdown from `isolatedDeclarations`):
// - normalised: comments and formatting ignored, chunk hashes ignored, export
//   lists sorted, declarations marked `@internal` left out;
// - compared per package as a set of top-level statements.
// A changed package needs (a) a changeset bumping it at least `minor`,
// (b) a change under docs/ or to TSDoc in its src/, and (c) a "Site impact:"
// other than `none`. The changed declarations go to the job summary.
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

/** End of the item starting at `from`: after `;` or `,` at depth 0, or after a block that closes at depth 0. */
function itemEnd(s: string, from: number): number {
  let depth = 0;
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
    } else if (c === '}' || c === ')' || c === ']') {
      if (depth === 0) return i;
      depth--;
      if (depth === 0 && c === '}' && opened && !CONTINUES.test(s.slice(i + 1))) {
        const semi = /^\s*;/.exec(s.slice(i + 1));
        return i + 1 + (semi ? semi[0].length : 0);
      }
    } else if ((c === ';' || c === ',') && depth === 0) {
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

/** The `name` and `private` fields of a package.json. */
function readPackage(file: string): { name: string; private: boolean } {
  const pkg: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const get = (k: string): unknown =>
    typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, k) : undefined;
  const name = get('name');
  return { name: typeof name === 'string' ? name : file, private: get('private') === true };
}

const mark = (ok: boolean): string => (ok ? '✅' : '❌');

function dtsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? dtsFiles(p) : /\.d\.[mc]?ts$/.test(name) ? [p] : [];
  });
}

/** Published package name → its normalised declaration statements. */
function surface(root: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const dir of readdirSync(join(root, 'packages'))) {
    const pkgFile = join(root, 'packages', dir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const pkg = readPackage(pkgFile);
    if (pkg.private) continue;
    const set = new Set<string>();
    for (const f of dtsFiles(join(root, 'packages', dir, 'dist'))) {
      for (const s of statements(readFileSync(f, 'utf8'))) set.add(s);
    }
    out.set(pkg.name, set);
  }
  return out;
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
  const baseDir = mkdtempSync(join(tmpdir(), 'api-base-'));
  sh(root, 'git', ['worktree', 'add', '--detach', baseDir, base]);
  try {
    build(baseDir);
    const before = surface(baseDir);
    const dirs = new Map<string, string>();
    for (const dir of readdirSync(join(root, 'packages'))) {
      const f = join(root, 'packages', dir, 'package.json');
      if (existsSync(f)) dirs.set(readPackage(f).name, relative(root, join(root, 'packages', dir)));
    }

    const changes: { name: string; added: string[]; removed: string[] }[] = [];
    for (const [name, now] of head) {
      const was = before.get(name) ?? new Set<string>();
      const added = [...now].filter((s) => !was.has(s));
      const removed = [...was].filter((s) => !now.has(s));
      if (added.length || removed.length) changes.push({ name, added, removed });
    }
    if (changes.length === 0) {
      say('## API check\n\nThe published declarations are unchanged.');
      return;
    }

    const impact = parseSiteImpact(prBody());
    const bumped = bumps(root, base);
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
