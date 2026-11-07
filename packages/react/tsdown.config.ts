import { defineConfig } from 'tsdown';

// The framework is a peer and @isoloop/* are dependencies: all stay imports.
export default defineConfig({ entry: ['src/index.ts'], platform: 'browser', dts: true });
