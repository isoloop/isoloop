// The memory ladder page (plant memory investigation): one rung at a time.
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';
import { frameworkPlugins, jsxFor } from '../../frameworks.config.ts';
import { isoloop } from '../../packages/vite/src/index.ts';

export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  plugins: [
    ...frameworkPlugins('react', 19),
    isoloop({
      bus: false,
      isolates: { vanilla: 'isolates/vanilla.ts', react: 'isolates/react.tsx' },
    }),
  ],
  oxc: jsxFor('react'),
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  base: './',
});
