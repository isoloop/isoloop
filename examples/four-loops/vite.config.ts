// From source, like the other workspace packages: Vite loads its config before
// any condition applies, and nothing is built first. An app writes '@isoloop/vite'.
import { isoloop } from '../../packages/vite/src/index.ts';
import { defaultClientConditions, defineConfig } from 'vite';

// Workspace packages resolve to their src (ADR 0009, rule 3), so the demo
// runs without building them first. `@isoloop/vite` gives the worker URLs
// (`virtual:isoloop/workers`), the dev headers, and `?isolate` imports: each
// isolate module, and the contracts module, is emitted as its own chunk with
// its exports kept.
export default defineConfig({
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  plugins: [isoloop()],
  base: './',
});
