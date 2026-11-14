// Builds the adapter conformance fixtures (M3a task 13), one self-contained
// ES module per framework major, into e2e/isolates/adapter-<fw>-<major>.js,
// and the visual pools suite's widget (M2d task 6) on the newest major of each
// framework, into e2e/isolates/adapter-pool-widget-<fw>.js, and the four-loops
// fixtures (the proof of concept's isolates and contracts, from
// e2e/isolates/loops) into e2e/isolates/loops-<name>.js, where the isolate
// servers serve them. `node e2e/build-adapters.ts`.
import { fileURLToPath } from 'node:url';
import { build, defaultClientConditions } from 'vite';
import { frameworkPlugins, jsxFor, MAJORS } from '../frameworks.config.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

const NEWEST = [
  ['preact', 11],
  ['react', 19],
] as const;

type Build = { fw: 'preact' | 'react'; major: number; entry: string; out: string };

const builds: Build[] = [
  ...MAJORS.map(([fw, major]) => ({
    fw,
    major,
    entry: `e2e/isolates/adapters/${fw}/app.tsx`,
    out: `adapter-${fw}-${major}.js`,
  })),
  ...NEWEST.map(([fw, major]) => ({
    fw,
    major,
    entry: `e2e/isolates/adapters/${fw}/pool-widget.tsx`,
    out: `adapter-pool-widget-${fw}.js`,
  })),
  // The four-loops fixtures. The vanilla isolates and the contracts use no
  // framework; P and R render with the newest majors, as the demo did.
  ...['counter', 'ticker', 'heavy', 'messages', 'store', 'contracts'].map((name) => ({
    fw: 'react' as const,
    major: 19,
    entry: `e2e/isolates/loops/${name}.ts`,
    out: `loops-${name}.js`,
  })),
  {
    fw: 'preact',
    major: 11,
    entry: 'e2e/isolates/loops/votes-preact.tsx',
    out: 'loops-votes-preact.js',
  },
  {
    fw: 'react',
    major: 19,
    entry: 'e2e/isolates/loops/votes-react.tsx',
    out: 'loops-votes-react.js',
  },
];

for (const { fw, major, entry, out } of builds) {
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
        entry,
        formats: ['es'],
        fileName: () => out,
      },
    },
  });
}
