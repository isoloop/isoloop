import { defineConfig } from 'tsdown';

export default defineConfig([
  // The package API, for isolate code and adapters. Dependencies stay imports.
  { entry: ['src/index.ts', 'src/testing.ts'], platform: 'browser', dts: true },
  // The isolate worker entries, loaded by URL: one self-contained file each.
  // `worker` is what @isoloop/vite loads (the bootstrap inlined behind its
  // message hold); `bootstrap` stays for workers started from it directly.
  ...['src/bootstrap.ts', 'src/worker.ts'].map((entry) => ({
    entry: [entry],
    platform: 'browser' as const,
    dts: false,
    clean: false,
    deps: { alwaysBundle: ['@isoloop/protocol', /^@isoloop\/dom\//] },
    // The on-demand imports stay in the same file.
    outputOptions: { inlineDynamicImports: true },
  })),
]);
