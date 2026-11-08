import { defineConfig } from '@playwright/test';

// The M2c benchmark gate (bench/pools/README.md). It launches its own
// browsers (Chromium, Firefox, WebKit) so it can read their processes'
// memory, so it has no projects. Run with `pnpm bench:pools`; never part of
// `pnpm e2e`.
export default defineConfig({
  testDir: '.',
  testMatch: 'pools.spec.ts',
  reporter: 'list',
  workers: 1,
  timeout: 900_000,
  webServer: {
    command:
      'vite build --config vite.config.ts && vite preview --config vite.config.ts --port 4811 --strictPort',
    url: 'http://localhost:4811/',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
