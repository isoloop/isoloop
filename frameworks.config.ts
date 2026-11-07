/*
 * The framework majors the adapters support (ADR 0010), and how a Vite build
 * resolves one of them: Preact through its npm: alias in packages/preact,
 * React through its packages/react/majors package. Used by vitest.config.ts
 * (one test project per major) and e2e/build-adapters.ts (one E2E fixture
 * per major).
 */
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export type Framework = 'preact' | 'react';
export const MAJORS: readonly (readonly [Framework, number])[] = [
  ['preact', 10],
  ['preact', 11],
  ['react', 18],
  ['react', 19],
];

/**
 * Resolves `name` and its subpaths as `as` from the package at `dir`, for
 * every importer, the framework's own files included, so there's one copy.
 * Resolving through the package (not an alias to a path) keeps `exports`.
 */
const frameworkFrom = (dir: string, name: string, as = name): Plugin => {
  const match = new RegExp(`^${name}(?=/|$)`);
  const from = fileURLToPath(new URL(`${dir}/package.json`, import.meta.url));
  return {
    name: `isoloop:${as}`,
    enforce: 'pre',
    resolveId(id, _importer, opts) {
      if (!match.test(id)) return null;
      return this.resolve(id.replace(match, as), from, { ...opts, skipSelf: true });
    },
  };
};

/** The plugins that pin `fw` to `major`. */
export function frameworkPlugins(fw: Framework, major: number): Plugin[] {
  if (fw === 'preact') return [frameworkFrom('./packages/preact', 'preact', `preact${major}`)];
  const from = `./packages/react/majors/${major}`;
  return [frameworkFrom(from, 'react-dom'), frameworkFrom(from, 'react')];
}

/** The JSX transform for `fw`. */
export const jsxFor = (fw: Framework): { jsx: { runtime: 'automatic'; importSource: string } } => ({
  jsx: { runtime: 'automatic', importSource: fw },
});
