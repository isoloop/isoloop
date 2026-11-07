// From source, like the other workspace packages: Vite loads its config before
// any condition applies, and nothing is built first. An app writes '@isoloop/vite'.
import { frameworkPlugins } from '../../frameworks.config.ts';
import { isoloop } from '../../packages/vite/src/index.ts';
import { defaultClientConditions, defineConfig } from 'vite';

// Workspace packages resolve to their src (ADR 0009, rule 3), so the demo
// runs without building them first. `@isoloop/vite` gives the worker URLs
// (`virtual:isoloop/workers`), the dev headers, and `?isolate` imports: each
// isolate module, and the contracts module, is emitted as its own chunk with
// its exports kept.
export default defineConfig({
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  // P and R render with Preact 11 and React 19, the newest majors; `.tsx`
  // defaults to React's JSX, and P's file asks for Preact's.
  plugins: [...frameworkPlugins('preact', 11), ...frameworkPlugins('react', 19), isoloop()],
  base: './',
});
