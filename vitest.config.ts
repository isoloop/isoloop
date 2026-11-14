import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';
import { frameworkPlugins, jsxFor } from './frameworks.config';

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

type Engine = 'chromium' | 'firefox' | 'webkit';

const browser = (
  name: string,
  include = `packages/${name}/src/**/*.test.ts`,
  engines: Engine[] = ['chromium'],
) => ({
  test: {
    name,
    include: [include],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: engines.map((engine) => ({ browser: engine })),
    },
  },
});

// The adapters run their tests once per supported framework major (ADR 0010).
// Each project resolves the framework to that major (frameworks.config.ts).
// `major` is provided to the tests, so a wrong alias fails CI.
// `pnpm dom:usage` sets ISOLOOP_DOM_USAGE=write: the DOM usage checks rewrite
// packages/dom/usage instead of comparing with it (M3a task 2).
const writeUsage = process.env.ISOLOOP_DOM_USAGE === 'write';

const preact = (major: 10 | 11) => ({
  plugins: frameworkPlugins('preact', major),
  // Served as is (it's ESM): discovered mid-run, Vite would re-optimize and
  // reload, and a worker that already loaded the old copy got a second Preact.
  optimizeDeps: { exclude: [`preact${major}`] },
  oxc: jsxFor('preact'),
  test: {
    ...browser(`preact-${major}`, 'packages/preact/src/**/*.test.{ts,tsx}').test,
    provide: { major, writeUsage },
  },
});

const react = (major: 18 | 19) => {
  return {
    plugins: frameworkPlugins('react', major),
    // React is CommonJS, so it has to be optimized; listed up front, because
    // discovered mid-run Vite re-optimizes and reloads, and a worker that
    // already loaded the old copy gets a second React.
    optimizeDeps: { entries: ['packages/react/src/**/*.{ts,tsx}'] },
    oxc: jsxFor('react'),
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
      node('vite'),
      // The core diagrams' drift test (docs/diagrams/README.md).
      {
        test: {
          name: 'diagrams',
          include: ['docs/diagrams/**/*.test.ts'],
          environment: 'node',
        },
      },
      // OPFS differs by engine (M2b), so the bus worker's tests run in all three.
      browser('bus-browser', 'packages/bus/src/**/*.browser.test.ts', [
        'chromium',
        'firefox',
        'webkit',
      ]),
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
