import { defineConfig, devices } from '@playwright/test';

// E2E against the built demo, in the three engines Playwright ships (ADR 0009).
// The port avoids Vite's default 4173 so a local preview elsewhere doesn't clash.
const port = 4791;
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `pnpm --filter four-loops build && pnpm --filter four-loops preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !ci,
    timeout: 60_000,
  },
});
