import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeIo } from '../program/io';
import { main } from '../program/main';

const skills = fileURLToPath(new URL('../../../../skills/', import.meta.url));
const source = join(skills, 'build-with-isoloop', 'SKILL.md');
const installed = join('.claude', 'skills', 'build-with-isoloop', 'SKILL.md');

let cwd = '';
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'isoloop-skill-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** `isoloop skill add` on real files, in a scratch working directory. */
async function add(args: readonly string[] = [], from = skills) {
  let out = '';
  let err = '';
  const code = await main(['skill', 'add', ...args], {
    ...nodeIo(from),
    cwd,
    out: (t) => void (out += t),
    err: (t) => void (err += t),
  });
  return { code, out, err };
}

describe('isoloop skill add', () => {
  it('copies the skill, byte for byte, into .claude/skills', async () => {
    const r = await add();
    expect(r).toEqual({ code: 0, out: `Added ${join(cwd, installed)}\n`, err: '' });
    expect(await readFile(join(cwd, installed))).toEqual(await readFile(source));
  });

  it('copies into --dir, relative or absolute', async () => {
    for (const dir of ['agent/skills', join(cwd, 'elsewhere')]) {
      // oxlint-disable-next-line no-await-in-loop -- one run after the other
      expect((await add(['--dir', dir])).code).toBe(0);
    }
    const want = await readFile(source);
    expect(await readFile(join(cwd, 'agent/skills/build-with-isoloop/SKILL.md'))).toEqual(want);
    expect(await readFile(join(cwd, 'elsewhere/build-with-isoloop/SKILL.md'))).toEqual(want);
  });

  it('leaves an identical copy alone', async () => {
    await add();
    expect(await add()).toEqual({
      code: 0,
      out: `Already up to date: ${join(cwd, installed)}\n`,
      err: '',
    });
  });

  it('keeps a copy that differs, unless --force', async () => {
    await add();
    await writeFile(join(cwd, installed), 'edited');
    const kept = await add();
    expect(kept.code).toBe(1);
    expect(kept.err).toContain('--force replaces it');
    expect(await readFile(join(cwd, installed), 'utf8')).toBe('edited');

    const replaced = await add(['--force']);
    expect(replaced.code).toBe(0);
    expect(replaced.out).toContain('Replaced');
    expect(await readFile(join(cwd, installed))).toEqual(await readFile(source));
  });

  it('keeps an edited copy that is empty', async () => {
    await add();
    await writeFile(join(cwd, installed), '');
    expect((await add()).code).toBe(1);
  });

  it('keeps what a linked SKILL.md points at', async () => {
    await mkdir(join(cwd, '.claude', 'skills', 'build-with-isoloop'), { recursive: true });
    await writeFile(join(cwd, 'mine.md'), 'mine');
    await symlink(join(cwd, 'mine.md'), join(cwd, installed));
    expect((await add()).code).toBe(1);
    expect(await readFile(join(cwd, 'mine.md'), 'utf8')).toBe('mine');
  });

  it('fails when the folder is a file, or the install has no skill', async () => {
    await writeFile(join(cwd, 'file'), '');
    const blocked = await add(['--dir', 'file']);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain("can't write");

    const none = await add([], join(cwd, 'none'));
    expect(none.code).toBe(1);
    expect(none.err).toContain('this install has no skill');
  });

  it('refuses an argument, which would otherwise be ignored', async () => {
    expect((await add(['my-skills'])).code).toBe(2);
  });
});
