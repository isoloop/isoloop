import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { realpathSync } from 'node:fs';
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
const pkgDir = (from: string, name: string) =>
  realpathSync(fileURLToPath(new URL(`${from}/node_modules/${name}`, import.meta.url)));

const preact = (major: 10 | 11) => ({
  oxc: { jsx: { runtime: 'automatic' as const, importSource: 'preact' } },
  resolve: { alias: [{ find: /^preact(?=\/|$)/, replacement: `preact${major}` }] },
  test: {
    ...browser(`preact-${major}`, 'packages/preact/src/**/*.test.{ts,tsx}').test,
    provide: { major },
  },
});

const react = (major: 18 | 19) => {
  const from = `./packages/react/majors/${major}`;
  return {
    oxc: { jsx: { runtime: 'automatic' as const, importSource: 'react' } },
    resolve: {
      alias: [
        { find: /^react-dom(?=\/|$)/, replacement: pkgDir(from, 'react-dom') },
        { find: /^react(?=\/|$)/, replacement: pkgDir(from, 'react') },
      ],
    },
    test: {
      ...browser(`react-${major}`, 'packages/react/src/**/*.test.{ts,tsx}').test,
      provide: { major },
    },
  };
};

export default defineConfig({
  resolve: { conditions: [source, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [source, ...defaultServerConditions] } },
  test: {
    projects: [
      node('protocol'),
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
