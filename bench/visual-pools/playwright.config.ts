import { defineConfig } from '@playwright/test';

// The M2d benchmark gate (bench/visual-pools/README.md). Like the M2c gate,
// it launches its own browsers to read their processes' memory, so it has no
// projects. Run with `pnpm bench:visual-pools`; never part of `pnpm e2e`.
export default defineConfig({
  testDir: '.',
  testMatch: 'visual-pools.spec.ts',
  reporter: 'list',
  workers: 1,
  timeout: 1_800_000,
  webServer: {
    command:
      'vite build --config vite.config.ts && vite preview --config vite.config.ts --port 4812 --strictPort',
    url: 'http://localhost:4812/',
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});
