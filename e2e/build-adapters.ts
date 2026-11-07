// Builds the adapter conformance fixtures (M3a task 13), one self-contained
// ES module per framework major, into e2e/isolates/adapter-<fw>-<major>.js,
// where the isolate servers serve them. `node e2e/build-adapters.ts`.
import { fileURLToPath } from 'node:url';
import { build, defaultClientConditions } from 'vite';
import { frameworkPlugins, jsxFor, MAJORS } from '../frameworks.config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

for (const [fw, major] of MAJORS) {
  // oxlint-disable-next-line no-await-in-loop -- one build at a time keeps the log readable
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    plugins: frameworkPlugins(fw, major),
    resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
    oxc: jsxFor(fw),
    // React reads it; a worker has no `process`.
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: 'e2e/isolates',
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: `e2e/isolates/adapters/${fw}/app.tsx`,
        formats: ['es'],
        fileName: () => `adapter-${fw}-${major}.js`,
      },
    },
  });
}
