import { defineConfig, devices } from '@playwright/test';

// The bus throughput bench (plan m2-bus, task 13) on the E2E harness page.
// Chromium only, as design §10 has it for CI benches. Run with
// `pnpm bench:throughput`; never part of `pnpm e2e`.
export default defineConfig({
  testDir: '.',
  testMatch: 'bus-throughput.spec.ts',
  reporter: 'list',
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'pnpm --filter e2e-harness build && pnpm --filter e2e-harness preview --port 4794 --strictPort',
    url: 'http://localhost:4794/',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
