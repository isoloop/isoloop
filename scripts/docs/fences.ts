// `docs:check` item 2 (M4c, decision 22): every `ts` and `tsx` fence in the
// guides type-checks against the workspace packages, so a rename fails CI in
// the guide that still shows the old name. ` ```ts nocheck ` opts a fragment
// out (docs/writing.md).
//
// Each fence becomes its own module in `node_modules/.cache/docs-fences/`, and
// one `tsc --noEmit` run checks them all. `@isoloop/*` resolves to the
// packages' source through their `@isoloop/source` export condition, as the
// tests do (ADR 0009, rule 3); other packages resolve to the first workspace
// package that depends on them. A `tsx` fence that imports Preact gets a
// `@jsxImportSource preact` pragma; the rest compile as React.
//
// The fences sit next to a small example app, `scripts/docs/fence-app/`: its
// prelude declares the few names a guide builds on (`kernel`, `contracts`,
// `workers`), and its modules are what fences import as `./contracts`,
// `./schemas`, `./alerts` and `./topics`. `@isoloop/vite/client` and `vite/client` give
// `virtual:isoloop/*`, `*?isolate` and `import.meta.env`.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import type { Problem } from './markdown.ts';

export type Fence = {
  /** The guide, relative to the repo root. */
  file: string;
  /** 1-based line of the fence's first code line in the guide. */
  line: number;
  lang: 'ts' | 'tsx';
  code: string;
};

/** The `ts` and `tsx` fences of a guide that aren't marked `nocheck`. */
export function extractFences(file: string, md: string): Fence[] {
  const out: Fence[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)(.*)$/.exec(lines[i] ?? '');
    if (!open) continue;
    const marker = open[2] ?? '```';
    const lang = open[3] ?? '';
    const info = (open[4] ?? '').trim().split(/\s+/);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j] ?? '';
      if (l.trim().startsWith(marker) && l.trim().replace(/[`~]/g, '') === '') break;
      body.push(l);
    }
    if ((lang === 'ts' || lang === 'tsx') && !info.includes('nocheck'))
      out.push({ file, line: i + 2, lang, code: dedent(body).join('\n') });
    i = j;
  }
  return out;
}

const dedent = (body: string[]): string[] => {
  const indents = body.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)?.[0].length ?? 0);
  const n = indents.length ? Math.min(...indents) : 0;
  return body.map((l) => l.slice(n));
};

/** Bare module specifiers a fence imports (`import … from 'x'`, `import('x')`). */
export function importsOf(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"./][^'"]*)['"]/g))
    if (m[1]) out.add(m[1]);
  return [...out];
}

/** The package a specifier belongs to (`@scope/name/sub` → `@scope/name`). */
export const packageOf = (spec: string): string => {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
};

const usesPreact = (code: string): boolean =>
  importsOf(code).some((s) => packageOf(s) === 'preact' || packageOf(s) === '@isoloop/preact');

/** Module file name for a fence: guide name, line, extension. */
export const moduleName = (f: Fence): string =>
  `${f.file.replace(/^.*\//, '').replace(/\.md$/, '')}-${f.line}.${f.lang}`;

/** The source written for a fence, and how many lines were put before its code. */
export function moduleSource(f: Fence): { text: string; offset: number } {
  const pragma = f.lang === 'tsx' && usesPreact(f.code) ? '/** @jsxImportSource preact */\n' : '';
  // `export {}` keeps a fence without imports a module, so fences don't share a scope.
  const text = `${pragma}${f.code}\nexport {};\n`;
  return { text, offset: pragma ? 1 : 0 };
}

type Paths = Record<string, string[]>;

/** A field of a parsed JSON value, or `undefined`. */
const field = (v: unknown, k: string): unknown =>
  typeof v === 'object' && v !== null ? Reflect.get(v, k) : undefined;

/** `@isoloop/*` specifiers → their source files, from each package's `exports`. */
export function workspacePaths(root: string, from: string): Paths {
  const paths: Paths = {};
  for (const dir of readdirSync(join(root, 'packages'))) {
    const pkgFile = join(root, 'packages', dir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const pkg: unknown = JSON.parse(readFileSync(pkgFile, 'utf8'));
    const name = field(pkg, 'name');
    const exports = field(pkg, 'exports');
    if (typeof name !== 'string' || typeof exports !== 'object' || exports === null) continue;
    for (const [sub, target] of Object.entries(exports)) {
      const src = field(target, '@isoloop/source');
      if (typeof src !== 'string') continue;
      const spec = sub === '.' ? name : `${name}/${sub.replace(/^\.\//, '')}`;
      paths[spec] = [relative(from, join(root, 'packages', dir, src))];
    }
  }
  return paths;
}

/**
 * A third-party package's folder: the first workspace package that has it
 * installed, else the root. For a package without its own types, its
 * `@types/` folder.
 */
export function findPackage(root: string, name: string): string | undefined {
  const homes = [
    ...readdirSync(join(root, 'packages')).map((d) => join(root, 'packages', d)),
    root,
  ];
  const typed = name.startsWith('@') ? undefined : `@types/${name}`;
  for (const candidate of typed ? [typed, name] : [name])
    for (const home of homes) {
      const dir = join(home, 'node_modules', candidate);
      if (existsSync(join(dir, 'package.json'))) return dir;
    }
  return undefined;
}

/** Writes the fences' modules and tsconfig into `dir`; returns module → fence. */
export function writeProject(
  root: string,
  dir: string,
  fences: Fence[],
): Map<string, Fence & { offset: number }> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const byModule = new Map<string, Fence & { offset: number }>();
  const paths = workspacePaths(root, dir);
  const external = new Set<string>(['react', 'react-dom', 'preact']);
  for (const f of fences) {
    const { text, offset } = moduleSource(f);
    const name = moduleName(f);
    writeFileSync(join(dir, name), text);
    byModule.set(name, { ...f, offset });
    for (const s of importsOf(f.code))
      if (!packageOf(s).startsWith('@isoloop/')) external.add(packageOf(s));
  }
  const app = join(root, 'scripts/docs/fence-app');
  for (const f of readdirSync(app)) copyFileSync(join(app, f), join(dir, f));
  external.add('zod');
  for (const name of external) {
    const found = findPackage(root, name);
    if (!found) continue;
    const rel = relative(dir, found);
    paths[name] = [rel];
    paths[`${name}/*`] = [`${rel}/*`];
  }
  const vite = findPackage(root, 'vite');
  const refs = [
    join(root, 'packages/vite/client.d.ts'),
    ...(vite ? [join(vite, 'client.d.ts')] : []),
  ];
  writeFileSync(
    join(dir, 'env.d.ts'),
    refs.map((r) => `/// <reference path="${relative(dir, r)}" />\n`).join(''),
  );
  const tsconfig = {
    extends: relative(dir, join(root, 'tsconfig.base.json')),
    compilerOptions: {
      // The newest lib any package uses (the balancer's ES2023), so imported
      // source checks as it does in its own package.
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      jsx: 'react-jsx',
      types: [],
      // A guide shows how to use a value, not always that it's used.
      noUnusedLocals: false,
      noUnusedParameters: false,
      paths,
    },
    include: ['*.ts', '*.tsx'],
  };
  writeFileSync(join(dir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
  return byModule;
}

/** `tsc --pretty false` output → problems at the guide's lines. */
export function mapDiagnostics(
  output: string,
  byModule: Map<string, Fence & { offset: number }>,
): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const line of output.split('\n')) {
    const m = /^(?:.*[\\/])?([^\\/(]+)\((\d+),(\d+)\): error (TS\d+: .*)$/.exec(line.trim());
    if (!m) continue;
    const f = byModule.get(m[1] ?? '');
    if (!f) {
      // An error outside the fences (a workspace file the fences import) still fails.
      if (!seen.has(line)) problems.push({ file: 'docs/guide', message: line.trim() });
      seen.add(line);
      continue;
    }
    const at = f.line + Number(m[2]) - 1 - f.offset;
    problems.push({ file: `${f.file}:${at}`, message: `fence doesn't type-check: ${m[4]}` });
  }
  return problems;
}

/** Item 2 over every guide: writes the project, runs the repo's `tsc`, maps errors back. */
export function checkFences(
  root: string,
  guides: { file: string; md: string }[],
  dir = join(root, 'node_modules/.cache/docs-fences'),
): Problem[] {
  const fences = guides.flatMap((g) => extractFences(g.file, g.md));
  if (fences.length === 0) return [];
  const byModule = writeProject(root, dir, fences);
  const tsc = join(root, 'node_modules/.bin/tsc');
  try {
    execFileSync(tsc, ['-p', join(dir, 'tsconfig.json'), '--pretty', 'false'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return [];
  } catch (e) {
    const text = (k: string): string => {
      const v = field(e, k);
      return typeof v === 'string' ? v : '';
    };
    const out = `${text('stdout')}${text('stderr')}`;
    const problems = mapDiagnostics(out, byModule);
    return problems.length > 0
      ? problems
      : [{ file: 'docs/guide', message: `tsc failed: ${out.trim()}` }];
  }
}
