// The layout a project's formatter uses, read from the config nearest a file.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeIo } from '../program/io';
import { DEFAULT_STYLE, type Style, styleFor } from './style';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'isoloop-style-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    // oxlint-disable-next-line no-await-in-loop -- setup
    await mkdir(join(root, path, '..'), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- setup
    await writeFile(join(root, path), text);
  }
}

const styleOf = (path: string, cache = new Map<string, Style>()): Promise<Style> =>
  styleFor(nodeIo(''), root, join(root, path), cache);

describe('styleFor', () => {
  it("is Prettier's defaults without a config", async () => {
    await put({ 'src/a.ts': '' });
    expect(await styleOf('src/a.ts')).toEqual(DEFAULT_STYLE);
  });

  it("reads oxfmt's config, with oxfmt's defaults for what it leaves out", async () => {
    await put({ '.oxfmtrc.json': '{ "singleQuote": true }', 'src/a.ts': '' });
    expect(await styleOf('src/a.ts')).toEqual({ ...DEFAULT_STYLE, printWidth: 100 });
  });

  it('takes the nearest config, with comments and Prettier fields', async () => {
    await put({
      '.oxfmtrc.json': '{ "printWidth": 120 }',
      'app/.prettierrc':
        '{\n  // tabs here\n  "useTabs": true, "tabWidth": 4, "trailingComma": "es5",\n}',
      'app/src/a.ts': '',
      'lib/package.json': '{ "prettier": { "printWidth": 90 } }',
      'lib/a.ts': '',
    });
    expect(await styleOf('app/src/a.ts')).toEqual({
      printWidth: 80,
      indent: '\t',
      tabWidth: 4,
      trailingComma: false,
    });
    expect(await styleOf('lib/a.ts')).toEqual({ ...DEFAULT_STYLE, printWidth: 90 });
  });

  it('skips a package.json without a prettier field', async () => {
    await put({ 'pkg/package.json': '{ "name": "x" }', 'pkg/a.ts': '' });
    expect(await styleOf('pkg/a.ts')).toEqual(DEFAULT_STYLE);
  });
});
