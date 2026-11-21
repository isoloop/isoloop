import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkLayout, diskRepo, entriesOf, projectsOf, type Project, type Repo } from './layout.ts';

/** A repo as a map of path to text. */
function repo(files: Record<string, string>): Repo {
  const paths = Object.keys(files);
  paths.sort();
  return {
    files: paths,
    read: (p) => {
      const t = files[p];
      if (t === undefined) throw new Error(`no ${p}`);
      return t;
    },
  };
}

const manifest = (o: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: '@x/a',
    exports: { '.': { '@isoloop/source': './src/index.ts', import: './dist/index.js' } },
    ...o,
  });

const projects: Project[] = [
  { include: ['packages/a/src/**/*.test.ts'], exclude: ['**/*.browser.test.ts'] },
];

/** A package that follows every rule. */
const good: Record<string, string> = {
  'packages/a/package.json': manifest(),
  'packages/a/src/index.ts': "export { x } from './area/x';\n",
  'packages/a/src/index.test.ts': "import { x } from './index';\n",
  'packages/a/src/area/x.ts':
    "import { version } from '../../package.json';\nexport const x = version;\n",
  'packages/a/src/area/x.test.ts':
    "const at = new URL('../__fixtures__/w.ts', import.meta.url);\nconst some = (n: string) => new URL(`../__fixtures__/${n}.ts`, import.meta.url);\n",
  'packages/a/src/__fixtures__/w.ts': "import '../../../b/src/worker.ts';\n",
  'packages/a/src/__fixtures__/app/iso/clock.ts': 'export {};\n',
  'packages/a/test/fake.ts': 'export const fake = 1;\n',
};

const check = (files: Record<string, string>, pending: string[] = [], p = projects) =>
  checkLayout(repo(files), p, pending);

const messages = (files: Record<string, string>, pending: string[] = [], p = projects): string[] =>
  check(files, pending, p).map((x) => `${x.file}: ${x.message}`);

describe('the layout check', () => {
  it('passes a package that follows ADR 0021', () => {
    expect(check(good)).toEqual([]);
  });

  it('reads entries from exports, the build script and tsdown.config.ts', () => {
    const entries = entriesOf(
      {
        exports: {
          './worker': { '@isoloop/source': './src/worker/index.ts', import: './dist/w.js' },
        },
        scripts: { build: 'tsdown src/cli.ts --platform node' },
      },
      "export default defineConfig({ entry: { panel: 'src/panel.tsx' } });",
    );
    expect(entries).toEqual(new Set(['cli.ts', 'panel.tsx', 'worker/index.ts']));
  });

  it('rule 1: only entries and tests named after them sit at the top of src/', () => {
    const out = messages({
      ...good,
      'packages/a/src/helper.ts': 'export {};\n',
      'packages/a/src/helper.test.ts': 'export {};\n',
      'packages/a/src/index.kernel.test.ts': 'export {};\n',
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('packages/a/src/helper.test.ts: the top of src/ holds only');
    expect(out[1]).toContain('packages/a/src/helper.ts: the top of src/ holds only');
  });

  it('rule 2: index.ts is only ever an entry', () => {
    const out = messages({ ...good, 'packages/a/src/area/index.ts': 'export {};\n' });
    expect(out).toEqual([
      expect.stringContaining('packages/a/src/area/index.ts: index files are only ever entries'),
    ]);
    // dom keeps its entries in folders.
    const dom = {
      'packages/d/package.json': JSON.stringify({
        name: '@x/d',
        exports: { './worker': { '@isoloop/source': './src/worker/index.ts' } },
      }),
      'packages/d/src/worker/index.ts': 'export {};\n',
      'packages/d/src/worker/dom.ts': 'export {};\n',
    };
    expect(check(dom)).toEqual([]);
  });

  it('rule 3: areas are one level deep, kebab-case, and never a kind', () => {
    const out = messages({
      ...good,
      'packages/a/src/area/deep/y.ts': 'export {};\n',
      'packages/a/src/area/deep/z.ts': 'export {};\n',
      'packages/a/src/utils/u.ts': 'export {};\n',
      'packages/a/src/myArea/m.ts': 'export {};\n',
    });
    expect(out).toEqual([
      expect.stringContaining('packages/a/src/area/deep/: folders under src/ are one level deep'),
      expect.stringContaining('packages/a/src/myArea/: area names are kebab-case'),
      expect.stringContaining('packages/a/src/utils/: "utils" names a kind'),
    ]);
  });

  it('rule 4: fixtures only at src/__fixtures__, and no tests in test/', () => {
    const out = messages({
      ...good,
      'packages/a/src/area/__fixtures__/f.ts': 'export {};\n',
      'packages/a/test/fake.test.ts': 'export {};\n',
    });
    expect(out).toContainEqual(
      expect.stringContaining('packages/a/src/area/__fixtures__/f.ts: fixtures live in'),
    );
    expect(out).toContainEqual(
      expect.stringContaining('packages/a/test/fake.test.ts: test/ holds helpers'),
    );
  });

  it('rule 5: shipped code never leaves its package by a relative path', () => {
    const out = messages({
      ...good,
      'packages/a/src/area/x.ts': "import { y } from '../../../b/src/y';\nexport const x = y;\n",
    });
    expect(out).toEqual([
      expect.stringContaining(
        'packages/a/src/area/x.ts: line 1: "../../../b/src/y" leaves packages/a',
      ),
    ]);
  });

  it('rule 5 ignores comments, such as a TSDoc example', () => {
    const files = {
      ...good,
      'packages/a/src/area/x.ts':
        "/**\n * import { y } from '../../../b/src/y';\n */\nexport const x = 1;\n",
    };
    expect(check(files)).toEqual([]);
  });

  it('rule 6: every test file is in a Vitest project', () => {
    const out = messages({ ...good, 'packages/a/src/area/x.browser.test.ts': 'export {};\n' });
    expect(out).toEqual([
      expect.stringContaining("packages/a/src/area/x.browser.test.ts: no Vitest project's include"),
    ]);
    const browser = [
      ...projects,
      { include: ['packages/a/src/**/*.browser.test.ts'], exclude: [] },
    ];
    expect(check({ ...good, 'packages/a/src/area/x.browser.test.ts': '' }, [], browser)).toEqual(
      [],
    );
  });

  it('rule 7: every file a test or fixture loads by URL exists', () => {
    const out = messages({
      ...good,
      'packages/a/src/area/x.test.ts': [
        "const a = new URL('../__fixtures__/gone.ts', import.meta.url);",
        'const b = (n: string) => new URL(`./__fixtures__/${n}.ts`, import.meta.url);',
        "import url from '../__fixtures__/gone?worker&url';",
      ].join('\n'),
    });
    expect(out).toEqual([
      expect.stringContaining('line 3: "../__fixtures__/gone?worker&url" resolves to nothing'),
      expect.stringContaining('line 1: "../__fixtures__/gone.ts" resolves to nothing'),
      expect.stringContaining('line 2: "./__fixtures__/" resolves to nothing'),
    ]);
  });

  it('rule 7 ignores code a test writes out as a string', () => {
    const files = {
      ...good,
      'packages/a/src/area/x.test.ts':
        "write('i.js', \"export const at = () => new URL('./gone.js', import.meta.url);\");\n" +
        "write('j.js', `import y from './gone?worker&url';`);\n",
    };
    expect(check(files)).toEqual([]);
  });

  it('rule 8: every ./src/ path in sideEffects exists', () => {
    const out = messages({
      ...good,
      'packages/a/package.json': manifest({
        sideEffects: ['./src/index.ts', './src/gone.ts', './dist/x.js'],
      }),
    });
    expect(out).toEqual([
      expect.stringContaining('packages/a/package.json: sideEffects names ./src/gone.ts'),
    ]);
  });

  it('skips rules 1–3 for a pending package, until it complies', () => {
    const messy = { ...good, 'packages/a/src/helper.ts': 'export {};\n' };
    expect(check(messy, ['a'])).toEqual([]);
    expect(messages(good, ['a'])).toEqual([
      expect.stringContaining('packages/a follows ADR 0021 now; take it out of PENDING'),
    ]);
    expect(messages(good, ['gone'])).toEqual([expect.stringContaining('PENDING names gone')]);
  });

  it('holds on this repo', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const config: unknown = (await import('../../vitest.config.ts')).default;
    expect(checkLayout(diskRepo(root), projectsOf(config))).toEqual([]);
  });
});
