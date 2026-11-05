import { defineConfig } from 'tsdown';

// Two entries: the package API and `@isoloop/bus/testing`. The bus worker
// bundle (`bus-worker.js`) arrives with M2 task 7.
export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  platform: 'neutral',
  dts: true,
});
