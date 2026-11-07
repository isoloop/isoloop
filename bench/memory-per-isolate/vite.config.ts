// The memory-per-isolate bench page (M3a task 17): cross-origin isolated, so
// `performance.measureUserAgentSpecificMemory()` works, with an idle vanilla,
// Preact 11 and React 19 isolate built by @isoloop/vite.
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';
import { frameworkPlugins, jsxFor } from '../../frameworks.config.ts';
import { isoloop } from '../../packages/vite/src/index.ts';

export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  plugins: [
    ...frameworkPlugins('preact', 11),
    ...frameworkPlugins('react', 19),
    isoloop({
      bus: false,
      crossOriginIsolated: true,
      isolates: {
        vanilla: 'isolates/vanilla.ts',
        preact: 'isolates/preact.tsx',
        react: 'isolates/react.tsx',
      },
    }),
  ],
  // JSX per file: the Preact isolate says so with a pragma.
  oxc: jsxFor('react'),
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  base: './',
});
