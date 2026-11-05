import { defineConfig, devices } from '@playwright/test';

// The click-to-paint bench (plan m1-kernel, task 13) in all three engines, on
// the E2E harness page. One worker, so engines don't compete for the CPU. Run with `pnpm bench:click-to-paint`; never part of `pnpm e2e`.
export default defineConfig({
  testDir: '.',
  testMatch: 'click-to-paint.spec.ts',
  reporter: 'list',
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command:
      'pnpm --filter e2e-harness build && pnpm --filter e2e-harness preview --port 4794 --strictPort',
    url: 'http://localhost:4794/',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
