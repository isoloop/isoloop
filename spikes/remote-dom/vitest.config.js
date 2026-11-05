import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  optimizeDeps: {
    include: ['@remote-dom/core', '@remote-dom/core/elements', '@remote-dom/core/polyfill'],
  },
  worker: { format: 'es' },
  test: {
    testTimeout: 30000,
    include: ['*.test.js'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
