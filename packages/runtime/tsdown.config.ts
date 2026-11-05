import { defineConfig } from 'tsdown';

export default defineConfig([
  // The package API, for isolate code and adapters. Dependencies stay imports.
  { entry: ['src/index.ts'], platform: 'browser', dts: true },
  // The isolate worker entry, loaded by URL: one self-contained file.
  {
    entry: ['src/bootstrap.ts'],
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { alwaysBundle: ['@isoloop/protocol', /^@isoloop\/dom\//] },
    // The on-demand import of the vanilla runtime stays in the same file.
    outputOptions: { inlineDynamicImports: true },
  },
]);
