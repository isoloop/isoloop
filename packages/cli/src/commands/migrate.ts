/*
 * `isoloop migrate [version]` (ADR 0019, decision 10): rewrites a project's
 * source for a release that changed an API. It starts from the installed
 * `@isoloop/*` version and runs every step up to the target. A dry run by
 * default: the diff goes to stdout, so it can be piped to `git apply`, and
 * everything else to stderr.
 */
import { join } from 'node:path';
import { UsageError } from '../program/args';
import { EXIT, type Command } from '../program/command';
import { resolvePath } from '../program/io';
import { version as cliVersion } from '../program/version';
import { unifiedDiff } from '../migrate/diff';
import { FLAG_PREFIX } from '../migrate/edit';
import { installed } from '../migrate/installed';
import { loadParser } from '../migrate/parser';
import { migrateFolder } from '../migrate/run';
import type { Step } from '../migrate/step';
import {
  compare,
  format,
  latest,
  parseVersion,
  STEPS,
  stepsBetween,
  type Version,
} from '../migrate/steps';

const versionArg = (text: string, what: string): Version => {
  const v = parseVersion(text);
  if (v === undefined) throw new UsageError(`${what} must be a version such as 0.2, not ${text}`);
  return v;
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The command over `steps`; tests pass their own. */
export function migrateCommand(steps: readonly Step[]): Command {
  return {
    path: ['migrate'],
    summary: 'Rewrite your source for an Isoloop release that changed an API.',
    usage: '[version]',
    details: [
      'Starts from the installed @isoloop/* version (or --from) and runs each step up to [version], by default the newest this CLI knows.',
      'Reads the .ts, .tsx, .js and .jsx files under the working directory (or --dir), outside node_modules and dot-folders.',
      'Prints the changes as a diff and writes nothing, unless --write is given.',
      `Code it can't rewrite safely gets a "${FLAG_PREFIX}" comment above it, listed at the end.`,
      'Run it before you upgrade, or pass --from with the version you upgraded from.',
      "Exits 1 when a file doesn't parse; that file is left as it is.",
    ].join(' '),
    flags: {
      write: { type: 'boolean', description: 'Write the changes to the files' },
      from: {
        type: 'string',
        value: 'version',
        description: 'The version the code is written for (default: the installed one)',
      },
      dir: {
        type: 'string',
        value: 'folder',
        description: 'The folder to migrate (default: the working directory)',
      },
      help: { type: 'boolean', short: 'h', description: 'Show this help' },
    },
    async run(args, io) {
      if (args.positionals.length > 1) throw new UsageError('takes at most one version');
      const [to] = args.positionals;
      const target = to === undefined ? undefined : versionArg(to, 'the version');
      const { dir, from: fromFlag, write } = args.flags;
      const root = resolvePath(io, typeof dir === 'string' ? dir : '.');

      // Where the code is now.
      let from: Version;
      if (typeof fromFlag === 'string') {
        from = versionArg(fromFlag, '--from');
      } else {
        const found = await installed(io, root);
        if (found === undefined) {
          io.err(
            `isoloop migrate: no @isoloop/* package is installed in ${root} or above; install them, or pass --from <version>\n`,
          );
          return EXIT.failed;
        }
        const all = [...found.versions.values()].flatMap((v) => {
          const p = parseVersion(v);
          return p === undefined ? [] : [{ text: v, v: p }];
        });
        const lowest = all.toSorted(
          (a, b) => compare(a.v, b.v) || Number(b.v.before) - Number(a.v.before),
        )[0];
        if (lowest === undefined) {
          io.err(`isoloop migrate: can't read the installed @isoloop/* versions; pass --from\n`);
          return EXIT.failed;
        }
        if (new Set(all.map((a) => a.text)).size > 1) {
          io.err(
            `Installed @isoloop/* versions differ; starting from the lowest, ${lowest.text}.\n`,
          );
        }
        from = lowest.v;
      }

      // Where it's going: a version past what this CLI knows needs a newer CLI.
      const own = parseVersion(cliVersion());
      const known = [latest(steps), own]
        .filter((v) => v !== undefined)
        .toSorted(compare)
        .at(-1);
      if (target !== undefined && known !== undefined && compare(target, known) > 0) {
        io.err(
          `isoloop migrate: this CLI (${cliVersion()}) knows steps up to ${format(known)}; run npx isoloop@latest migrate ${format(target)}\n`,
        );
        return EXIT.failed;
      }

      const chosen = stepsBetween(from, target, steps);
      const goal = target === undefined ? 'the newest' : format(target);
      if (chosen.length === 0) {
        io.err(`Nothing to migrate from ${format(from)} to ${goal}.\n`);
        return EXIT.ok;
      }
      io.err(
        `Migrating ${root} from ${format(from)}${from.before ? ' (a prerelease)' : ''} to ${goal}:\n${chosen
          .map((s) => `  ${s.version}: ${s.summary}\n`)
          .join('')}`,
      );

      const result = await migrateFolder({ io, root, steps: chosen, parser: loadParser });
      for (const f of result.changed) {
        if (write === true) {
          // oxlint-disable-next-line no-await-in-loop -- one file at a time
          await io.writeFile(join(root, f.path), f.after);
          io.out(`Changed ${f.path}\n`);
        } else {
          io.out(unifiedDiff(f.path, f.before, f.after));
        }
      }

      const flags = result.changed.flatMap((f) =>
        f.flags.map((x) => `  ${f.path}:${x.line}: ${x.message}\n`),
      );
      if (flags.length > 0) {
        io.err(`\nNeeds a look, marked with "${FLAG_PREFIX}":\n${flags.join('')}`);
      }
      if (result.failed.length > 0) {
        io.err(
          `\nDidn't parse, left as they are:\n${result.failed.map((f) => `  ${f.path}: ${f.message}\n`).join('')}`,
        );
      }
      const n = result.changed.length;
      const of = `of ${plural(result.scanned, 'source file')}`;
      io.err(
        write === true
          ? `\n${plural(n, 'file')} ${of} changed.\n`
          : `\n${plural(n, 'file')} ${of} would change.${n > 0 ? ' Run again with --write to apply.' : ''}\n`,
      );
      return result.failed.length > 0 ? EXIT.failed : EXIT.ok;
    },
  };
}

export const migrate: Command = migrateCommand(STEPS);
