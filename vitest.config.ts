import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions, defaultServerConditions } from 'vite';
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
    ],
  },
});
