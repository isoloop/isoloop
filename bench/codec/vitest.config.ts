import { playwright } from '@vitest/browser-playwright';
import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// `pnpm bench:codec`: the codec evaluation in Chromium, Firefox and WebKit.
export default defineConfig({
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  test: {
    root: import.meta.dirname,
    include: ['*.browser-bench.ts'],
    testTimeout: 300_000,
    // The report is the console output; Vitest hides it for passing tests otherwise.
    silent: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
    },
  },
});
