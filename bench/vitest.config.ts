import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Benches are plain Vitest files timed with performance.now(), kept out of the
// root config so `pnpm test` never runs them. `pnpm bench` runs this config.
export default defineConfig({
  ssr: { resolve: { conditions: ['@isoloop/source', ...defaultServerConditions] } },
  test: {
    root: import.meta.dirname,
    include: ['**/*.bench.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
