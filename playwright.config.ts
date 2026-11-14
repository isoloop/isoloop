import { defineConfig, devices } from '@playwright/test';
import { HARNESS, ISOLATES_CORS, ISOLATES_NO_CORS } from './e2e/servers';

// E2E in the three engines Playwright ships (ADR 0009). The harness is a blank
// page for tests that bring their own isolates (the four-loops ones included,
// e2e/loops.ts); the two isolate servers are other origins, with and without
// CORS. The ports avoid Vite's default 4173 so a local preview elsewhere doesn't clash.
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // One test at a time on CI: the isolation suite measures frame rates and
  // timing, which parallel tests on a small runner would distort.
  ...(ci ? { workers: 1 } : {}),
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: HARNESS,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: `pnpm --filter e2e-harness build && pnpm --filter e2e-harness preview --port 4794 --strictPort`,
      url: HARNESS,
      reuseExistingServer: !ci,
      timeout: 60_000,
    },
    {
      // The adapter and four-loops fixtures are built first; the server serves them.
      command: 'node e2e/build-adapters.ts && node e2e/isolate-server.ts 4795 --cors',
      url: ISOLATES_CORS,
      reuseExistingServer: !ci,
    },
    { command: 'node e2e/isolate-server.ts 4796', url: ISOLATES_NO_CORS, reuseExistingServer: !ci },
  ],
});
