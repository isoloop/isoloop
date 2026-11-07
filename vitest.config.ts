import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions, defaultServerConditions, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Cross-package imports resolve to src through the @isoloop/source condition
// (ADR 0009, rule 3), so tests never need a build first.
const source = '@isoloop/source';

// `*.browser.test.ts` in a Node package runs in Chromium instead, under
// `<name>-browser` (the bus worker in a real Worker, for example).
const node = (name: string) => ({
  test: {
    name,
    include: [`packages/${name}/src/**/*.test.ts`],
    exclude: ['**/*.browser.test.ts'],
    environment: 'node',
  },
});

const browser = (name: string, include = `packages/${name}/src/**/*.test.ts`) => ({
  test: {
    name,
    include: [include],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' as const }],
    },
  },
});

// The adapters run their tests once per supported framework major (ADR 0010).
// Each project resolves the framework to that major: Preact through its npm:
// alias in packages/preact, React through its packages/react/majors package.
// `major` is provided to the tests, so a wrong alias fails CI.
// `pnpm dom:usage` sets ISOLOOP_DOM_USAGE=write: the DOM usage checks rewrite
// packages/dom/usage instead of comparing with it (M3a task 2).
const writeUsage = process.env.ISOLOOP_DOM_USAGE === 'write';

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

const preact = (major: 10 | 11) => ({
  plugins: [frameworkFrom('./packages/preact', 'preact', `preact${major}`)],
  // Served as is (it's ESM): discovered mid-run, Vite would re-optimize and
  // reload, and a worker that already loaded the old copy got a second Preact.
  optimizeDeps: { exclude: [`preact${major}`] },
  oxc: { jsx: { runtime: 'automatic' as const, importSource: 'preact' } },
  test: {
    ...browser(`preact-${major}`, 'packages/preact/src/**/*.test.{ts,tsx}').test,
    provide: { major, writeUsage },
  },
});

const react = (major: 18 | 19) => {
  const from = `./packages/react/majors/${major}`;
  return {
    plugins: [frameworkFrom(from, 'react-dom'), frameworkFrom(from, 'react')],
    // React is CommonJS, so it has to be optimized; listed up front, because
    // discovered mid-run Vite re-optimizes and reloads, and a worker that
    // already loaded the old copy gets a second React.
    optimizeDeps: { entries: ['packages/react/src/**/*.{ts,tsx}'] },
    oxc: { jsx: { runtime: 'automatic' as const, importSource: 'react' } },
    test: {
      ...browser(`react-${major}`, 'packages/react/src/**/*.test.{ts,tsx}').test,
      provide: { major, writeUsage },
    },
  };
};

export default defineConfig({
  resolve: { conditions: [source, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] } },
  test: {
    projects: [
      node('protocol'),
      node('codec'),
      node('bus'),
      browser('bus-browser', 'packages/bus/src/**/*.browser.test.ts'),
      browser('dom'),
      browser('host'),
      browser('runtime'),
      preact(10),
      preact(11),
      react(18),
      react(19),
    ],
  },
});
