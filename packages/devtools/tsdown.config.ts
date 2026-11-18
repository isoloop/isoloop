import { defineConfig } from 'tsdown';
import { frameworkPlugins } from '../../frameworks.config.ts';

// Two builds:
// - the host entry, `mountDevtools`: @isoloop/host stays an import;
// - the panel, an isolate module with everything in it (Preact 11, the
//   adapter, the protocol), so an app loads it as is, whatever framework and
//   version it uses itself. Preact comes from packages/preact's alias, as the
//   E2E fixtures' does (frameworks.config.ts).
export default defineConfig([
  { entry: ['src/index.ts'], platform: 'browser', dts: true },
  {
    entry: { panel: 'src/panel.tsx' },
    platform: 'browser',
    dts: false,
    noExternal: [/.*/],
    plugins: frameworkPlugins('preact', 11),
    inputOptions: { transform: { jsx: { runtime: 'automatic', importSource: 'preact' } } },
    clean: false,
  },
]);
