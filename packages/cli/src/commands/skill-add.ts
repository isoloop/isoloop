/*
 * `isoloop skill add` (M4a decision 17): copies the "build with Isoloop"
 * skill that shipped with this CLI into the agent's skills folder. The build
 * puts `skills/` next to the bin, so the skill matches the CLI's version.
 */
import { join } from 'node:path';
import { UsageError } from '../program/args';
import { EXIT, type Command } from '../program/command';
import { resolvePath } from '../program/io';

/** The skill's folder name, which is also its `name` in SKILL.md. */
const NAME = 'build-with-isoloop';
const DEFAULT_DIR = '.claude/skills';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const skillAdd: Command = {
  path: ['skill', 'add'],
  summary: 'Copy the "build with Isoloop" skill into your project, for coding agents.',
  usage: '',
  details: [
    `Writes ${NAME}/SKILL.md into .claude/skills in the working directory, or into --dir.`,
    "The skill is the one that shipped with this CLI's version.",
    'Exits 1 when a different copy is already there, unless --force is given.',
  ].join(' '),
  flags: {
    dir: {
      type: 'string',
      value: 'folder',
      description: `The skills folder to copy into (default ${DEFAULT_DIR})`,
    },
    force: { type: 'boolean', description: 'Replace a copy that differs' },
    help: { type: 'boolean', short: 'h', description: 'Show this help' },
  },
  async run(args, io) {
    if (args.positionals.length > 0) {
      throw new UsageError('takes no arguments; use --dir to choose the folder');
    }
    const { dir } = args.flags;
    const folder = join(resolvePath(io, typeof dir === 'string' ? dir : DEFAULT_DIR), NAME);
    const target = join(folder, 'SKILL.md');
    try {
      const skill = await io.readFile(join(io.skills, NAME, 'SKILL.md'));
      if (skill === undefined) {
        io.err('isoloop skill add: this install has no skill; reinstall the isoloop package\n');
        return EXIT.failed;
      }
      const current = await io.readFile(target);
      if (current === skill) {
        io.out(`Already up to date: ${target}\n`);
        return EXIT.ok;
      }
      if (current !== undefined && args.flags['force'] !== true) {
        io.err(
          `isoloop skill add: ${target} differs from this version's skill (edited, or from another version); --force replaces it\n`,
        );
        return EXIT.failed;
      }
      await io.mkdir(folder);
      await io.writeFile(target, skill);
      io.out(`${current === undefined ? 'Added' : 'Replaced'} ${target}\n`);
      return EXIT.ok;
    } catch (e) {
      io.err(`isoloop skill add: can't write ${target}: ${messageOf(e)}\n`);
      return EXIT.failed;
    }
  },
};
