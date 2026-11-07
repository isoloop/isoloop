import { defineConfig, devices } from '@playwright/test';

// The memory-per-isolate bench (M3a task 17), Chromium only: it reads
// per-worker memory with measureUserAgentSpecificMemory, which needs
// cross-origin isolation, and asks Chromium to measure at once instead of
// at its next GC. Run with `pnpm bench:memory`; never part of `pnpm e2e`.
export default defineConfig({
  testDir: '.',
  testMatch: 'memory.spec.ts',
  reporter: 'list',
  workers: 1,
  timeout: 120_000,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Full Chromium in new headless mode: the headless shell lacks the memory API.
        channel: 'chromium',
        launchOptions: { args: ['--enable-blink-features=ForceEagerMeasureMemory'] },
      },
    },
  ],
  // Playwright runs it in this directory.
  webServer: {
    command:
      'vite build --config vite.config.ts && vite preview --config vite.config.ts --port 4797 --strictPort',
    url: 'http://localhost:4797/',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
