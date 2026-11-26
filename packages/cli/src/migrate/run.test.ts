import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeIo } from '../program/io';
import type { Edit, Flag } from './edit';
import { child, children, loadParser, walk } from './parser';
import { migrateFolder } from './run';
import type { Step } from './step';

/** A test step: `old(x)` becomes `renamed(x)`; `old(...xs)` is flagged instead. */
const rename: Step = {
  version: '9.0',
  summary: 'rename old',
  mayChange: (text) => text.includes('old('),
  transform(file) {
    const edits: Edit[] = [];
    const flags: Flag[] = [];
    walk(file.program, (n) => {
      if (n.type !== 'CallExpression') return;
      const callee = child(n, 'callee');
      if (callee?.type !== 'Identifier' || callee.name !== 'old') return;
      if (children(n, 'arguments').some((a) => a.type === 'SpreadElement')) {
        flags.push({ at: n.start, message: 'old(...) with a spread' });
      } else {
        edits.push({ start: callee.start, end: callee.end, text: 'renamed' });
      }
    });
    return { edits, flags };
  },
};

/** A second step after it: `renamed` becomes `final`, so flags must move with its edits. */
const second: Step = {
  version: '9.1',
  summary: 'rename again',
  mayChange: (text) => text.includes('renamed('),
  transform(file) {
    const edits: Edit[] = [];
    walk(file.program, (n) => {
      if (n.type === 'Identifier' && n.name === 'renamed') {
        edits.push({ start: n.start, end: n.end, text: 'finalName' });
      }
    });
    return { edits, flags: [] };
  },
};

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'isoloop-migrate-'));
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

const migrate = (steps: readonly Step[]) =>
  migrateFolder({ io: nodeIo(''), root, steps, parser: loadParser });

describe('migrateFolder', () => {
  it('runs the steps on source files only, outside node_modules and dot-folders', async () => {
    await put({
      'src/a.ts': 'old(1);\n',
      'src/b.tsx': 'export const B = () => <p>{old(2)}</p>;\n',
      'src/c.d.ts': 'declare function old(n: number): void;\nold(3);\n',
      'src/d.json': '{"old(": 1}\n',
      'node_modules/x/index.js': 'old(4);\n',
      '.cache/e.ts': 'old(5);\n',
      'src/f.ts': 'other(6);\n',
    });
    const r = await migrate([rename]);
    expect(r.changed.map((f) => [f.path, f.after])).toEqual([
      ['src/a.ts', 'renamed(1);\n'],
      ['src/b.tsx', 'export const B = () => <p>{renamed(2)}</p>;\n'],
    ]);
    expect(r.scanned).toBe(3);
    expect(r.failed).toEqual([]);
  });

  it("doesn't follow symlinked folders", async () => {
    await put({ 'real/a.ts': 'old(1);\n' });
    await symlink(join(root, 'real'), join(root, 'link'), 'dir');
    expect((await migrate([rename])).changed.map((f) => f.path)).toEqual(['real/a.ts']);
  });

  it('flags what it leaves, with the line of the code under the comment', async () => {
    await put({ 'a.ts': 'old(1);\nfunction f(xs: number[]) {\n  old(...xs);\n}\n' });
    const [f] = (await migrate([rename, second])).changed;
    expect(f?.after).toBe(
      'finalName(1);\nfunction f(xs: number[]) {\n  // isoloop-migrate: old(...) with a spread\n  old(...xs);\n}\n',
    );
    expect(f?.flags).toEqual([{ line: 4, message: 'old(...) with a spread' }]);
  });

  it("reports a file that doesn't parse and leaves it alone", async () => {
    await put({ 'bad.ts': 'old(1);\nconst = 2;\n', 'good.ts': 'old(1);\n' });
    const r = await migrate([rename]);
    expect(r.changed.map((f) => f.path)).toEqual(['good.ts']);
    expect(r.failed.map((f) => f.path)).toEqual(['bad.ts']);
    expect(r.failed[0]?.message).toMatch(/^line 2: /);
  });

  it("doesn't load the parser when no step can change a file", async () => {
    await put({ 'a.ts': 'other();\n' });
    let loaded = false;
    const r = await migrateFolder({
      io: nodeIo(''),
      root,
      steps: [rename],
      parser: () => {
        loaded = true;
        return loadParser();
      },
    });
    expect(r.changed).toEqual([]);
    expect(loaded).toBe(false);
  });
});
