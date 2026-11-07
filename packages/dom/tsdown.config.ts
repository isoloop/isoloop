import { defineConfig } from 'tsdown';

// One entry per subpath (ADR 0011 point 1); there's no root entry.
export default defineConfig({
  entry: {
    worker: 'src/worker/index.ts',
    host: 'src/host/index.ts',
    testing: 'src/testing/index.ts',
    'testing-usage': 'src/testing/usage.ts',
  },
  platform: 'browser',
  // The superset config (all of src, DOM lib); each half is still type-checked
  // on its own by `pnpm typecheck` (ADR 0011 point 5).
  tsconfig: 'tsconfig.testing.json',
  dts: true,
  deps: { neverBundle: ['vitest'] },
});
