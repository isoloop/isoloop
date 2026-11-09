// The M2d benchmark gate page (bench/visual-pools/README.md): 8 React widgets
// rendering through the isoloop-dom bridge, one per worker or all in one
// worker with one document and a root per member (ADR 0015, option D).
// Cross-origin isolated, like the M2c gate.
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';
import { frameworkPlugins, jsxFor } from '../../frameworks.config.ts';

export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  plugins: [...frameworkPlugins('react', 19)],
  worker: { format: 'es', plugins: () => [...frameworkPlugins('react', 19)] },
  oxc: jsxFor('react'),
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: { target: 'es2022' },
  base: './',
});
