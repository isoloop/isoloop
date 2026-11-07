import { defineConfig } from 'tsdown';

export default defineConfig([
  // The package API and `@isoloop/bus/testing`.
  { entry: ['src/index.ts', 'src/testing.ts'], platform: 'neutral', dts: true },
  // The bus worker entry, loaded by URL: one self-contained file, bus-worker.js.
  {
    entry: { 'bus-worker': 'src/worker.ts' },
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { alwaysBundle: ['@isoloop/protocol', '@isoloop/codec'] },
  },
]);
