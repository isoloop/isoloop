import { defaultClientConditions, defineConfig } from 'vite';

// Workspace packages resolve to their src (ADR 0009, rule 3), as in the demo.
export default defineConfig({
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  worker: { format: 'es' },
  base: './',
});
