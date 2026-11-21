// The bundle guard (ADR 0021, decisions 6 and 7). After `pnpm build`, it
// bundles the published dist through Vite's own build(), minified, and checks:
// - each library entry's import-time code, the code it runs when it's imported,
//   measured with side effects assumed (`sideEffects: false` would hide it);
// - that each script (an export without `types`) is listed in its package's
//   `sideEffects`, by both its ./src/ and its ./dist/ path;
// - seven app bundles and the four scripts.
// Every size has a budget in budgets.json: its size when recorded plus 5%,
// rounded up to the next 0.5 KB.
//
//   pnpm bench:bundle            check, as CI does after the build
//   pnpm bench:bundle --record   measure, set every budget again, rewrite the
//                                README's table (a PR that crosses a budget
//                                does this and says why)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Plugin } from 'vite';

export type Problem = { item: string; message: string };

/** A size, minified and gzipped, in bytes. */
export type Size = { min: number; gzip: number };

/** What the guard measures, by item id. */
export type Measured = Map<string, Size>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const field = (o: unknown, k: string): unknown => (isRecord(o) ? o[k] : undefined);

/** A budget: the size plus 5%, rounded up to the next 0.5 KB (ADR 0021, decision 7). */
export function budgetFor(bytes: number): number {
  return Math.ceil((bytes * 1.05) / 512) * 512;
}

/** Items over their budget, and items with none. */
export function overBudget(
  measured: Measured,
  budgets: Readonly<Record<string, number>>,
): Problem[] {
  const problems: Problem[] = [];
  for (const [item, size] of measured) {
    const budget = budgets[item];
    if (budget === undefined)
      problems.push({ item, message: 'has no budget; run pnpm bench:bundle --record' });
    else if (size.min > budget)
      problems.push({
        item,
        message: `${size.min} B minified is over its budget of ${budget} B. If the growth is meant, run pnpm bench:bundle --record and say why in the PR`,
      });
  }
  return problems;
}

/** One published export: its package, subpath, and `./src/` and `./dist/` targets. */
export type Entry = {
  pkg: string;
  name: string;
  spec: string;
  dist: string;
  src: string | undefined;
  typed: boolean;
};

/** A package.json's published exports (`publishConfig.exports`, else `exports`) with JS. */
export function entriesOf(dir: string, manifest: unknown): Entry[] {
  const name = field(manifest, 'name');
  if (typeof name !== 'string') return [];
  const exportsMap =
    field(field(manifest, 'publishConfig'), 'exports') ?? field(manifest, 'exports');
  const source = field(manifest, 'exports');
  if (!isRecord(exportsMap)) return [];
  return Object.entries(exportsMap).flatMap(([sub, cond]) => {
    const dist = field(cond, 'import');
    if (typeof dist !== 'string') return [];
    const src = field(field(source, sub), '@isoloop/source');
    return [
      {
        pkg: dir,
        name,
        spec: sub === '.' ? name : `${name}${sub.slice(1)}`,
        dist,
        src: typeof src === 'string' ? src : undefined,
        typed: typeof field(cond, 'types') === 'string',
      },
    ];
  });
}

/** Scripts (exports without `types`) that their package's `sideEffects` doesn't name. */
export function undeclaredScripts(entries: readonly Entry[], manifest: unknown): Problem[] {
  const listed = field(manifest, 'sideEffects');
  const names = new Set(Array.isArray(listed) ? listed.filter((s) => typeof s === 'string') : []);
  return entries
    .filter((e) => !e.typed)
    .flatMap((e) =>
      [e.src, e.dist]
        .filter((p): p is string => p !== undefined && !names.has(p))
        .map((p) => ({
          item: `script:${e.spec}`,
          message: `runs code when it loads, so sideEffects must name ${p} (ADR 0021, decision 6)`,
        })),
    );
}

// --- Measuring ---------------------------------------------------------------

const FRAMEWORKS = /^(?:react|react-dom|preact)(?:\/|$)/;

/** A bare specifier: a package, not a path, a virtual module or the entry. */
const bare = (id: string): boolean => !/^(?:[./\0]|entry$)/.test(id);

/** The repo's published packages, by name: their folder and exports. */
export type Packages = ReadonlyMap<string, { dir: string; entries: readonly Entry[] }>;

/** Resolves `@isoloop/<pkg>[/<sub>]` and `isoloop` to the package's published dist. */
function published(root: string, packages: Packages): Plugin {
  return {
    name: 'isoloop-published',
    resolveId(id) {
      for (const [name, p] of packages) {
        if (id !== name && !id.startsWith(`${name}/`)) continue;
        const e = p.entries.find((x) => x.spec === id);
        if (e) return join(root, p.dir, e.dist);
      }
      return undefined;
    },
  };
}

/** Virtual modules, for the bundles' entry code and for tests. */
function virtual(modules: Readonly<Record<string, string>>): Plugin {
  return {
    name: 'virtual',
    resolveId: (id) => (id in modules ? `\0${id}` : undefined),
    load: (id) => (id.startsWith('\0') ? modules[id.slice(1)] : undefined),
  };
}

export type Bundle = {
  /** The entry's code, or a file path. */
  input: string;
  modules?: Readonly<Record<string, string>>;
  /** Treat every module as having side effects: the import-time measurement. */
  sideEffects?: boolean;
  /** Bare specifiers to leave out, beyond the frameworks. */
  external?: (id: string) => boolean;
  plugins?: Plugin[];
};

/**
 * Every module counts as having side effects, chunks included: Vite's resolver
 * would otherwise mark a package's files side-effect-free from its
 * `sideEffects: false`, which hides the code they run on import.
 */
const assumeSideEffects: Plugin = {
  name: 'assume-side-effects',
  enforce: 'pre',
  async resolveId(id, importer, options) {
    const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
    return resolved ? { ...resolved, moduleSideEffects: true } : null;
  },
};

/** The minified and gzipped size of one bundle, built with Vite. */
export async function measure(root: string, b: Bundle): Promise<Size> {
  const modules = b.modules ?? {};
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    root,
    plugins: [
      virtual(modules),
      ...(b.plugins ?? []),
      ...(b.sideEffects ? [assumeSideEffects] : []),
    ],
    build: {
      write: false,
      minify: true,
      modulePreload: false,
      reportCompressedSize: false,
      rolldownOptions: {
        input: b.input,
        external: (id) => FRAMEWORKS.test(id) || (b.external?.(id) ?? false),
        ...(b.sideEffects ? { treeshake: { moduleSideEffects: () => true } } : {}),
      },
    },
  });
  const outputs = Array.isArray(out) ? out : [out];
  let code = '';
  for (const o of outputs) {
    const chunks: unknown = field(o, 'output');
    if (!Array.isArray(chunks)) continue;
    for (const c of chunks) {
      const text = field(c, 'code');
      if (field(c, 'type') === 'chunk' && typeof text === 'string') code += text;
    }
  }
  return { min: Buffer.byteLength(code), gzip: code === '' ? 0 : gzipSync(code).length };
}

/** The app bundles: what a page, a contracts module and an isolate import. */
export const APPS: Readonly<Record<string, string>> = {
  'host page': "import { createKernel } from '@isoloop/host'; console.log(createKernel);",
  'host page with devtools':
    "import { createKernel } from '@isoloop/host'; import { connectDevtools } from '@isoloop/devtools'; console.log(createKernel, connectDevtools);",
  'host page with the balancer':
    "import { createKernel } from '@isoloop/host'; import { createBalancer } from '@isoloop/balancer'; console.log(createKernel, createBalancer);",
  'contracts module':
    "import { contracts, topic } from '@isoloop/bus'; console.log(contracts, topic);",
  'React isolate':
    "import { defineIsolate, useTopic } from '@isoloop/react'; console.log(defineIsolate, useTopic);",
  'Preact isolate':
    "import { defineIsolate, useTopic } from '@isoloop/preact'; console.log(defineIsolate, useTopic);",
  'vanilla isolate':
    "import { defineIsolate } from '@isoloop/runtime'; console.log(defineIsolate);",
};

/** The repo's published packages, read from packages/*. */
export function readPackages(root: string): Packages {
  const out = new Map<string, { dir: string; entries: Entry[] }>();
  for (const d of readdirSync(join(root, 'packages'))) {
    const file = join(root, 'packages', d, 'package.json');
    if (!existsSync(file)) continue;
    const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (field(manifest, 'private') === true) continue;
    const name = field(manifest, 'name');
    if (typeof name === 'string')
      out.set(name, {
        dir: join('packages', d),
        entries: entriesOf(join('packages', d), manifest),
      });
  }
  return out;
}

/** Every measurement: import-time code per library entry, the app bundles, the scripts. */
export async function measureAll(root: string, packages: Packages): Promise<Measured> {
  const measured: Measured = new Map();
  const resolve = published(root, packages);
  const all = [...packages.values()].flatMap((p) => p.entries);
  for (const e of all.filter((x) => x.typed)) {
    // Its own code only: every other package stays out (Isoloop's count on their
    // own entries; dependencies such as dom/testing's Vitest aren't Isoloop's).
    const own = (id: string): boolean => id === e.name || id.startsWith(`${e.name}/`);
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps memory flat
    const size = await measure(root, {
      input: 'entry',
      modules: { entry: `import ${JSON.stringify(e.spec)};` },
      sideEffects: true,
      external: (id) => bare(id) && !own(id),
      plugins: [resolve],
    });
    measured.set(`import-time:${e.spec}`, size);
  }
  for (const [label, code] of Object.entries(APPS)) {
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps memory flat
    const size = await measure(root, {
      input: 'entry',
      modules: { entry: code },
      plugins: [resolve],
    });
    measured.set(`app:${label}`, size);
  }
  for (const e of all.filter((x) => !x.typed)) {
    // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps memory flat
    const size = await measure(root, { input: join(root, e.pkg, e.dist), plugins: [resolve] });
    measured.set(`script:${e.spec}`, size);
  }
  return measured;
}

// --- Running it ----------------------------------------------------------------

const kb = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

/** The README's table, between its markers. */
export function table(measured: Measured, budgets: Readonly<Record<string, number>>): string {
  const rows = [...measured].map(
    ([item, s]) =>
      `| ${item.replace(/^(\w[\w-]*):/, '$1 · ')} | ${kb(s.min)} | ${kb(s.gzip)} | ${kb(budgets[item] ?? 0)} |`,
  );
  return ['| Item | Minified | Gzipped | Budget |', '| --- | --- | --- | --- |', ...rows].join(
    '\n',
  );
}

async function main(): Promise<void> {
  const root = join(import.meta.dirname, '../..');
  const here = join(root, 'bench/bundle-size');
  const record = process.argv.includes('--record');
  const packages = readPackages(root);
  const missing = [...packages.values()]
    .flatMap((p) => p.entries.map((e) => join(root, p.dir, e.dist)))
    .filter((f) => !existsSync(f));
  if (missing.length > 0) {
    console.error(`no built dist at ${missing[0] ?? ''}: run pnpm build first`);
    process.exitCode = 1;
    return;
  }
  const problems: Problem[] = [];
  for (const p of packages.values()) {
    const manifest: unknown = JSON.parse(readFileSync(join(root, p.dir, 'package.json'), 'utf8'));
    problems.push(...undeclaredScripts(p.entries, manifest));
  }
  const measured = await measureAll(root, packages);
  const budgetFile = join(here, 'budgets.json');
  const budgets: Record<string, number> = {};
  if (record) {
    for (const [item, s] of measured) budgets[item] = budgetFor(s.min);
    writeFileSync(budgetFile, `${JSON.stringify(budgets, null, 2)}\n`);
    const require = createRequire(import.meta.resolve('vite'));
    const viteVersion = String(field(require('vite/package.json'), 'version'));
    const rolldownVersion = String(field(require('rolldown/package.json'), 'version'));
    const isoloopVersion = String(
      field(JSON.parse(readFileSync(join(root, 'packages/host/package.json'), 'utf8')), 'version'),
    );
    const date = new Date().toISOString().slice(0, 10);
    const readme = readFileSync(join(here, 'README.md'), 'utf8');
    const block = `<!-- table:start -->\nRecorded ${date}: Isoloop \`${isoloopVersion}\`, Vite ${viteVersion} (Rolldown ${rolldownVersion}), minified, with only the framework left out.\n\n${table(measured, budgets)}\n<!-- table:end -->`;
    writeFileSync(
      join(here, 'README.md'),
      readme.replace(/<!-- table:start -->[\s\S]*<!-- table:end -->/, block),
    );
  } else {
    const parsed: unknown = JSON.parse(readFileSync(budgetFile, 'utf8'));
    if (isRecord(parsed))
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'number') budgets[k] = v;
    problems.push(...overBudget(measured, budgets));
  }
  console.log(table(measured, budgets));
  for (const p of problems) console.log(`error   ${p.item}: ${p.message}`);
  if (problems.length > 0) process.exitCode = 1;
  else console.log(record ? 'recorded' : 'every size is within its budget');
}

if (import.meta.main) await main();
