// The source layout of ADR 0021 (decision 8), checked over every package.
// `pnpm test` runs it through layout.test.ts.
//
// 1. The top of `src/` holds only entries and tests named after them.
// 2. `index.ts` is only ever an entry.
// 3. Folders under `src/` are one level deep (inside `__fixtures__/` they may
//    nest), kebab-case, and never a kind name. The CLI's codemod steps are
//    the one other place that nests: `packages/cli/src/migrate/<version>/`
//    holds a step and its `fixtures/`, the path ADR 0019 (decision 10) and
//    the changeset check name.
// 4. `__fixtures__/` exists only at `src/__fixtures__/`, and `test/` holds no
//    test files.
// 5. Shipped code never reaches outside its package by a relative path.
// 6. Every test file is in at least one Vitest project.
// 7. Every file a test or fixture loads by URL exists.
// 8. Every `./src/` path in a package's `sideEffects` exists.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, matchesGlob, posix } from 'node:path';

export type Problem = { file: string; message: string };

/** A repo as a list of files (repo-relative, `/`-separated) and a way to read one. */
export type Repo = {
  files: readonly string[];
  read: (path: string) => string;
};

/** A Vitest project's file globs, repo-relative. */
export type Project = { include: readonly string[]; exclude: readonly string[] };

const ADR = 'ADR 0021';
const FIXTURES = '__fixtures__';
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A codemod step's folder, `packages/cli/src/migrate/<major.minor>/…` (ADR 0019, decision 10). */
const isMigrateStep = (pkgDir: string, parts: readonly string[]): boolean =>
  pkgDir === 'packages/cli' &&
  parts[0] === 'migrate' &&
  /^\d+\.\d+$/.test(parts[1] ?? '') &&
  parts.length > 2;
const KIND_NAMES = new Set([
  'utils',
  'util',
  'helpers',
  'helper',
  'lib',
  'common',
  'misc',
  'types',
]);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const field = (o: unknown, k: string): unknown => (isRecord(o) ? o[k] : undefined);

/** The strings in `v`, if it's a list. */
const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

/** A published package: where it lives, its entries (paths inside `src/`) and its `sideEffects`. */
export type Package = {
  name: string;
  dir: string;
  entries: ReadonlySet<string>;
  sideEffects: readonly string[];
};

/** Every `./src/…` path an `exports` map's `@isoloop/source` conditions point at. */
function sourceTargets(v: unknown): string[] {
  if (typeof v === 'string') return [];
  if (!isRecord(v)) return [];
  return Object.entries(v).flatMap(([k, x]) =>
    k === '@isoloop/source' && typeof x === 'string' ? [x] : sourceTargets(x),
  );
}

/**
 * A package's entries: the files its `exports` (through `@isoloop/source`), its
 * build script and its `tsdown.config.ts` point at, as paths inside `src/`.
 */
export function entriesOf(manifest: unknown, tsdownConfig: string | undefined): Set<string> {
  const out = new Set<string>();
  const add = (p: string): void => {
    const m = /^(?:\.\/)?src\/(.+\.[cm]?[jt]sx?)$/.exec(p);
    if (m?.[1]) out.add(m[1]);
  };
  for (const t of sourceTargets(field(manifest, 'exports'))) add(t);
  const build = field(field(manifest, 'scripts'), 'build');
  if (typeof build === 'string') for (const t of build.split(/\s+/)) add(t);
  if (tsdownConfig !== undefined)
    for (const m of tsdownConfig.matchAll(/['"`]((?:\.\/)?src\/[^'"`]+)['"`]/g))
      if (m[1]) add(m[1]);
  return out;
}

/** The packages in `packages/*`, read from their `package.json` and `tsdown.config.ts`. */
export function packagesOf(repo: Repo): Package[] {
  const has = new Set(repo.files);
  const pkgs = repo.files
    .filter((f) => /^packages\/[^/]+\/package\.json$/.test(f))
    .map((f) => {
      const dir = posix.dirname(f);
      const manifest: unknown = JSON.parse(repo.read(f));
      const tsdown = has.has(`${dir}/tsdown.config.ts`)
        ? repo.read(`${dir}/tsdown.config.ts`)
        : undefined;
      const se = field(manifest, 'sideEffects');
      const name = field(manifest, 'name');
      return {
        name: typeof name === 'string' ? name : dir,
        dir,
        entries: entriesOf(manifest, tsdown),
        sideEffects: stringList(se),
      };
    });
  pkgs.sort((a, b) => a.dir.localeCompare(b.dir));
  return pkgs;
}

/** Paths inside a package's `src/`, split into segments; `undefined` outside it. */
function inSrc(pkg: Package, file: string): string[] | undefined {
  const prefix = `${pkg.dir}/src/`;
  return file.startsWith(prefix) ? file.slice(prefix.length).split('/') : undefined;
}

const isFixture = (file: string): boolean => file.split('/').includes(FIXTURES);
const isTest = (file: string): boolean => TEST_FILE.test(file);

/** Whether `file`, a name at the top of `src/`, is a test named after one of its entries (`worker.browser.test.ts`). */
function namedAfterEntry(file: string, entries: ReadonlySet<string>): boolean {
  return (
    isTest(file) &&
    [...entries].some((e) => !e.includes('/') && file.startsWith(`${e.replace(SOURCE_FILE, '')}.`))
  );
}

// --- Rules 1–3: what may sit where -------------------------------------------

/** Rules 1–3 for one package. */
export function checkTree(pkg: Package, files: readonly string[]): Problem[] {
  const problems: Problem[] = [];
  const say = (file: string, message: string): void => void problems.push({ file, message });
  const folders = new Set<string>();
  const nested = new Set<string>();
  for (const file of files) {
    const parts = inSrc(pkg, file);
    if (!parts) continue;
    const fixtureAt = parts.indexOf(FIXTURES);
    const path = parts.join('/');
    // Rule 1.
    if (parts.length === 1 && !pkg.entries.has(path) && !namedAfterEntry(path, pkg.entries))
      say(
        file,
        `the top of src/ holds only the package's entries and tests named after them (${ADR}, decision 1); move it into an area`,
      );
    // Rule 2.
    if (fixtureAt < 0 && /^index\.[cm]?[jt]sx?$/.test(parts.at(-1) ?? '') && !pkg.entries.has(path))
      say(
        file,
        `index files are only ever entries (${ADR}, decision 3); name the module after what it holds`,
      );
    // Rule 3.
    const dirs = parts.slice(0, -1);
    if (fixtureAt === 0) continue;
    if (isMigrateStep(pkg.dir, parts)) {
      folders.add('migrate');
      continue;
    }
    const limit = fixtureAt < 0 ? dirs.length : fixtureAt;
    if (limit > 1) nested.add(`${pkg.dir}/src/${dirs.slice(0, 2).join('/')}/`);
    for (const d of dirs.slice(0, Math.min(limit, 1))) folders.add(d);
  }
  for (const where of nested)
    say(
      where,
      `folders under src/ are one level deep (${ADR}, decision 2); only __fixtures__/ may nest`,
    );
  for (const d of folders) {
    const where = `${pkg.dir}/src/${d}/`;
    if (KIND_NAMES.has(d))
      say(
        where,
        `"${d}" names a kind, not a concept (${ADR}, decision 2); name the area for what it does`,
      );
    else if (!KEBAB.test(d)) say(where, `area names are kebab-case (${ADR}, decision 2)`);
  }
  return problems;
}

// --- Rule 4: fixtures and test helpers ---------------------------------------

export function checkFixtures(pkg: Package, files: readonly string[]): Problem[] {
  const problems: Problem[] = [];
  const home = `${pkg.dir}/src/${FIXTURES}/`;
  for (const file of files) {
    if (!file.startsWith(`${pkg.dir}/`)) continue;
    if (isFixture(file) && !file.startsWith(home))
      problems.push({
        file,
        message: `fixtures live in ${home} only (${ADR}, decision 4)`,
      });
    if (file.startsWith(`${pkg.dir}/test/`) && isTest(file))
      problems.push({
        file,
        message: `test/ holds helpers tests import, not tests: no Vitest project runs it there (${ADR}, decision 4); put it next to the code it tests`,
      });
  }
  return problems;
}

// --- Specifiers --------------------------------------------------------------

type Specifier = { spec: string; kind: 'import' | 'url' | 'url-prefix'; line: number };

/**
 * The source with its comments blanked (line numbers kept), and where its
 * string literals start and end. A template literal counts as one string, and
 * regex literals aren't recognised: close enough for finding specifiers.
 */
function lex(source: string): { code: string; strings: [number, number][] } {
  const out = source.split('');
  const strings: [number, number][] = [];
  const blankTo = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      blankTo(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blankTo(i, stop);
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      const start = i++;
      for (;;) {
        const ch = source[i];
        if (ch === undefined || ch === c || (c !== '`' && ch === '\n')) break;
        i += ch === '\\' ? 2 : 1;
      }
      strings.push([start, i]);
      i++;
    } else i++;
  }
  return { code: out.join(''), strings };
}

/**
 * Relative specifiers in code: static and dynamic imports and re-exports, and
 * `new URL(…, import.meta.url)`. Ones inside comments or string literals (code
 * a test writes out, for example) don't count.
 */
export function specifiers(source: string): Specifier[] {
  const { code, strings } = lex(source);
  const inString = (i: number): boolean => strings.some(([a, b]) => i > a && i < b);
  const lineOf = (i: number): number => code.slice(0, i).split('\n').length;
  const out: Specifier[] = [];
  const add = (m: RegExpMatchArray, spec: string | undefined, kind: Specifier['kind']): void => {
    if (spec?.startsWith('.') && !inString(m.index ?? 0))
      out.push({ spec, kind, line: lineOf(m.index ?? 0) });
  };
  for (const m of code.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|^[ \t]*import\s+)(['"])([^'"\n]*)\1/gm,
  ))
    add(m, m[2], 'import');
  for (const m of code.matchAll(/new\s+URL\(\s*(['"])([^'"\n]*)\1\s*,\s*import\.meta\.url\s*\)/g))
    add(m, m[2], 'url');
  for (const m of code.matchAll(
    /new\s+URL\(\s*`([^`$\n]*)\$\{[^`]*`\s*,\s*import\.meta\.url\s*\)/g,
  ))
    add(m, m[1], 'url-prefix');
  return out;
}

const target = (file: string, spec: string): string =>
  posix.normalize(posix.join(posix.dirname(file), spec.split('?')[0] ?? ''));

// --- Rule 5: shipped code stays inside its package ---------------------------

export function checkEscapes(
  pkg: Package,
  files: readonly string[],
  read: Repo['read'],
): Problem[] {
  const problems: Problem[] = [];
  for (const file of files) {
    if (!inSrc(pkg, file) || isTest(file) || isFixture(file) || !SOURCE_FILE.test(file)) continue;
    for (const s of specifiers(read(file))) {
      const to = target(file, s.spec);
      if (to !== pkg.dir && !to.startsWith(`${pkg.dir}/`))
        problems.push({
          file,
          message: `line ${s.line}: "${s.spec}" leaves ${pkg.dir} (${ADR}, decision 4); import the other package by name`,
        });
    }
  }
  return problems;
}

// --- Rule 6: every test file runs somewhere ----------------------------------

export function checkTestsRun(files: readonly string[], projects: readonly Project[]): Problem[] {
  return files
    .filter((f) => isTest(f) && /\.[cm]?tsx?$/.test(f))
    .filter(
      (f) =>
        !projects.some(
          (p) =>
            p.include.some((g) => matchesGlob(f, g)) && !p.exclude.some((g) => matchesGlob(f, g)),
        ),
    )
    .map((file) => ({
      file,
      message: `no Vitest project's include matches it, so it never runs (${ADR}, decision 8); move it or widen a glob in vitest.config.ts`,
    }));
}

// --- Rule 7: files loaded by URL exist ---------------------------------------

const URL_EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'];

export function checkUrls(
  pkgs: readonly Package[],
  files: readonly string[],
  read: Repo['read'],
  exists: (path: string) => boolean,
): Problem[] {
  const problems: Problem[] = [];
  for (const file of files) {
    const pkg = pkgs.find((p) => file.startsWith(`${p.dir}/`));
    if (!pkg || !SOURCE_FILE.test(file)) continue;
    const loads = isTest(file) || isFixture(file) || file.startsWith(`${pkg.dir}/test/`);
    if (!loads) continue;
    for (const s of specifiers(read(file))) {
      const to = target(file, s.spec);
      let ok: boolean;
      if (s.kind === 'url') ok = exists(to);
      else if (s.kind === 'url-prefix') ok = exists(s.spec.endsWith('/') ? to : posix.dirname(to));
      else if (s.spec.includes('?')) ok = URL_EXTS.some((e) => exists(`${to}${e}`));
      else continue; // A plain import: TypeScript resolves it.
      if (!ok)
        problems.push({
          file,
          message: `line ${s.line}: "${s.spec}" resolves to nothing (${ADR}, decision 8); fix the path`,
        });
    }
  }
  return problems;
}

// --- Rule 8: `sideEffects` names files that exist -----------------------------

export function checkSideEffects(pkg: Package, exists: (path: string) => boolean): Problem[] {
  return pkg.sideEffects
    .filter((s) => s.startsWith('./src/') && !exists(posix.join(pkg.dir, s)))
    .map((s) => ({
      file: `${pkg.dir}/package.json`,
      message: `sideEffects names ${s}, which doesn't exist (${ADR}, decision 6)`,
    }));
}

// --- All of it ---------------------------------------------------------------

/** Every rule over the repo. */
export function checkLayout(repo: Repo, projects: readonly Project[]): Problem[] {
  const has = new Set(repo.files);
  const dirs = new Set(
    repo.files.flatMap((f) =>
      f
        .split('/')
        .slice(0, -1)
        .map((_, i, a) => a.slice(0, i + 1).join('/')),
    ),
  );
  const exists = (p: string): boolean => has.has(p) || dirs.has(p.replace(/\/$/, ''));
  const pkgs = packagesOf(repo);
  const problems: Problem[] = [];
  for (const pkg of pkgs) {
    problems.push(...checkTree(pkg, repo.files));
    problems.push(
      ...checkFixtures(pkg, repo.files),
      ...checkEscapes(pkg, repo.files, repo.read),
      ...checkSideEffects(pkg, exists),
    );
  }
  problems.push(
    ...checkUrls(pkgs, repo.files, repo.read, exists),
    ...checkTestsRun(repo.files, projects),
  );
  return problems;
}

// --- Reading the real repo ---------------------------------------------------

const SKIP = new Set([
  'node_modules',
  'dist',
  'test-results',
  'bench-results',
  'playwright-report',
]);

/** The repo at `root`, without dot folders, dependencies and build output. */
export function diskRepo(root: string): Repo {
  const files: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel))) {
      if (name.startsWith('.') || SKIP.has(name)) continue;
      const path = rel === '' ? name : `${rel}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk('');
  files.sort();
  return { files, read: (p) => readFileSync(join(root, p), 'utf8') };
}

/** The include and exclude globs of each project in a Vitest config's `test.projects`. */
export function projectsOf(config: unknown): Project[] {
  const list = field(field(config, 'test'), 'projects');
  if (!Array.isArray(list)) throw new Error('vitest.config.ts: no test.projects');
  return list.map((p: unknown) => ({
    include: stringList(field(field(p, 'test'), 'include')),
    exclude: stringList(field(field(p, 'test'), 'exclude')),
  }));
}
