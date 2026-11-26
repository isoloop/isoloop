import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { child, children, walk } from '../migrate/parser';
import type { Step } from '../migrate/step';
import { parseArgs } from '../program/args';
import { nodeIo } from '../program/io';
import { main } from '../program/main';
import { migrateCommand } from './migrate';

let cwd = '';
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'isoloop-migrate-cmd-'));
  await mkdir(join(cwd, 'src'));
  await writeFile(join(cwd, 'src/app.ts'), 'ctx.bus.publish(t, { value: 1 });\n');
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** Installs fake `@isoloop/*` packages at these versions. */
async function install(versions: Record<string, string>, dir = cwd): Promise<void> {
  for (const [name, version] of Object.entries(versions)) {
    const at = join(dir, 'node_modules', '@isoloop', name);
    // oxlint-disable-next-line no-await-in-loop -- setup
    await mkdir(at, { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- setup
    await writeFile(
      join(at, 'package.json'),
      JSON.stringify({ name: `@isoloop/${name}`, version }),
    );
  }
}

async function migrate(args: readonly string[] = [], at = cwd) {
  let out = '';
  let err = '';
  const code = await main(['migrate', ...args], {
    ...nodeIo(''),
    cwd: at,
    out: (t) => void (out += t),
    err: (t) => void (err += t),
  });
  return { code, out, err };
}

describe('isoloop migrate', () => {
  it('starts from the installed version and runs the steps above it', async () => {
    await install({ host: '0.1.1', runtime: '0.1.1' });
    const r = await migrate();
    expect(r.code).toBe(0);
    expect(r.out).toBe('');
    expect(r.err).toContain(
      `Migrating ${cwd} from 0.1 to the newest:\n  0.2: supervisor.healthyAfterMs set beside supervisor.withinMs\n`,
    );
    expect(r.err).toContain('0 files of 1 source file would change.');
    expect(await readFile(join(cwd, 'src/app.ts'), 'utf8')).toBe(
      'ctx.bus.publish(t, { value: 1 });\n',
    );
  });

  it('finds the packages in a folder above, and starts from the lowest version', async () => {
    await install({ host: '0.1.1', bus: '0.1.0' });
    const r = await migrate(['--dir', 'src'], join(cwd));
    expect(r.code).toBe(0);
    expect(r.err).toContain(
      'Installed @isoloop/* versions differ; starting from the lowest, 0.1.0.',
    );
    const nested = await migrate([], join(cwd, 'src'));
    expect(nested.err).toContain(`Migrating ${join(cwd, 'src')} from 0.1 to the newest:`);
  });

  it("runs a release's step on its prereleases", async () => {
    await install({ host: '0.2.0-next.2' });
    expect((await migrate()).err).toContain('from 0.2 (a prerelease) to the newest:\n  0.2:');
  });

  it('has nothing to do once the code is on the target', async () => {
    await install({ host: '0.2.0' });
    expect(await migrate()).toEqual({
      code: 0,
      out: '',
      err: 'Nothing to migrate from 0.2 to the newest.\n',
    });
    expect((await migrate(['0.2', '--from', '0.1.1'])).err).toContain(
      '0.2: supervisor.healthyAfterMs set beside supervisor.withinMs',
    );
  });

  it('fails without installed packages, unless --from says where the code is', async () => {
    const r = await migrate();
    expect(r.code).toBe(1);
    expect(r.err).toContain('no @isoloop/* package is installed');
    expect((await migrate(['--from', '0.1'])).code).toBe(0);
  });

  it('sends a target past what it knows to a newer CLI', async () => {
    const r = await migrate(['9.0', '--from', '0.1']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('run npx isoloop@latest migrate 9.0');
  });

  it("refuses a version it can't read", async () => {
    const r = await migrate(['latest']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('the version must be a version such as 0.2, not latest');
    expect((await migrate(['0.2', '0.3'])).code).toBe(2);
    expect((await migrate(['--from', 'x'])).err).toContain('--from must be a version');
  });

  it('is listed in the help', async () => {
    let out = '';
    await main(['--help'], { ...nodeIo(''), out: (t) => void (out += t) });
    expect(out).toMatch(/^ {2}migrate +Rewrite your source/m);
  });

  describe('with a step that changes code', () => {
    /** `publish(t, { value: v })` becomes `publish(t, v)`; a variable passed instead is flagged. */
    const unwrap: Step = {
      version: '0.2',
      summary: 'unwrap publish',
      mayChange: (text) => text.includes('publish('),
      transform(file) {
        const edits: { start: number; end: number; text: string }[] = [];
        const flags: { at: number; message: string }[] = [];
        walk(file.program, (n) => {
          if (n.type !== 'CallExpression') return;
          const callee = child(n, 'callee');
          if (callee?.type !== 'MemberExpression' || child(callee, 'property')?.name !== 'publish')
            return;
          const arg = children(n, 'arguments')[1];
          if (arg?.type === 'Identifier') {
            flags.push({ at: n.start, message: 'publish takes the value itself' });
          } else if (arg?.type === 'ObjectExpression') {
            const value = children(arg, 'properties')[0];
            const v = value && child(value, 'value');
            if (v)
              edits.push({ start: arg.start, end: arg.end, text: file.text.slice(v.start, v.end) });
          }
        });
        return { edits, flags };
      },
    };
    const command = migrateCommand([unwrap]);

    async function run(args: readonly string[]) {
      let out = '';
      let err = '';
      const code = await command.run(parseArgs(args, command.flags), {
        ...nodeIo(''),
        cwd,
        out: (t) => void (out += t),
        err: (t) => void (err += t),
      });
      return { code, out, err };
    }

    beforeEach(async () => {
      await writeFile(
        join(cwd, 'src/other.ts'),
        'function f(rec) {\n  ctx.bus.publish(t, rec);\n}\n',
      );
    });

    it('prints a diff and writes nothing on a dry run', async () => {
      const r = await run(['--from', '0.1']);
      expect(r.code).toBe(0);
      expect(r.out).toBe(
        [
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1 +1 @@',
          '-ctx.bus.publish(t, { value: 1 });',
          '+ctx.bus.publish(t, 1);',
          '--- a/src/other.ts',
          '+++ b/src/other.ts',
          '@@ -1,3 +1,4 @@',
          ' function f(rec) {',
          '+  // isoloop-migrate: publish takes the value itself',
          '   ctx.bus.publish(t, rec);',
          ' }',
          '',
        ].join('\n'),
      );
      expect(r.err).toContain(
        'Needs a look, marked with "// isoloop-migrate:":\n  src/other.ts:3: publish takes the value itself\n',
      );
      expect(r.err).toContain(
        '2 files of 2 source files would change. Run again with --write to apply.',
      );
      expect(await readFile(join(cwd, 'src/app.ts'), 'utf8')).toBe(
        'ctx.bus.publish(t, { value: 1 });\n',
      );
    });

    it('writes the files with --write, and a second run changes nothing', async () => {
      const r = await run(['--from', '0.1', '--write']);
      expect(r.code).toBe(0);
      expect(r.out).toBe('Changed src/app.ts\nChanged src/other.ts\n');
      expect(await readFile(join(cwd, 'src/app.ts'), 'utf8')).toBe('ctx.bus.publish(t, 1);\n');
      const again = await run(['--from', '0.1', '--write']);
      expect(again.out).toBe('');
      expect(again.err).toContain('0 files of 2 source files changed.');
    });

    it("exits 1 when a file doesn't parse, and still migrates the rest", async () => {
      await writeFile(join(cwd, 'src/broken.ts'), 'publish(\n');
      const r = await run(['--from', '0.1', '--write']);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/Didn't parse, left as they are:\n {2}src\/broken\.ts: line \d+: /);
      expect(await readFile(join(cwd, 'src/app.ts'), 'utf8')).toBe('ctx.bus.publish(t, 1);\n');
    });
  });
});
