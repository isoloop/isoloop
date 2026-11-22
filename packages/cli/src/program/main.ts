/*
 * `isoloop`: picks the command from the first words of the command line,
 * parses the rest against its flags, and runs it. `--help` and `--version`
 * work at the top level; `--help` also after any command.
 */
import { flagsHelp, parseArgs, UsageError } from './args';
import { EXIT, type Command } from './command';
import { contractsExport } from '../commands/contracts-export';
import { mcp } from '../commands/mcp';
import { skillAdd } from '../commands/skill-add';
import type { Io } from './io';
import { version } from './version';

export { version };

/** Every command. */
export const COMMANDS: readonly Command[] = [contractsExport, mcp, skillAdd];

function topHelp(): string {
  const width = Math.max(...COMMANDS.map((c) => c.path.join(' ').length));
  const rows = COMMANDS.map((c) => `  ${c.path.join(' ').padEnd(width)}  ${c.summary}`);
  return [
    'Usage: isoloop <command> [options]',
    '',
    'Commands:',
    ...rows,
    '',
    'Options:',
    '  -h, --help     Show help (also after a command)',
    '  -v, --version  Show the version',
    '',
  ].join('\n');
}

function commandHelp(c: Command): string {
  return [
    `Usage: isoloop ${[...c.path, c.usage].filter((w) => w.length > 0).join(' ')} [options]`,
    '',
    c.summary,
    ...(c.details === undefined ? [] : ['', c.details]),
    '',
    'Options:',
    flagsHelp(c.flags),
    '',
  ].join('\n');
}

/** The command whose words start `argv`, the longest match first. */
function find(argv: readonly string[]): Command | undefined {
  let best: Command | undefined;
  for (const c of COMMANDS) {
    if (!c.path.every((w, i) => argv[i] === w)) continue;
    if (best === undefined || c.path.length > best.path.length) best = c;
  }
  return best;
}

/** Runs the CLI on `argv` (without node and the script). Returns the exit code. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const [first] = argv;
  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    (first === undefined ? io.err : io.out)(topHelp());
    return first === undefined ? EXIT.usage : EXIT.ok;
  }
  if (first === '-v' || first === '--version') {
    io.out(`${version()}\n`);
    return EXIT.ok;
  }
  const command = find(argv);
  if (command === undefined) {
    io.err(
      `isoloop: unknown command ${argv.filter((a) => !a.startsWith('-')).join(' ')}\n\n${topHelp()}`,
    );
    return EXIT.usage;
  }
  const rest = argv.slice(command.path.length);
  try {
    const args = parseArgs(rest, command.flags);
    if (args.flags['help'] === true) {
      io.out(commandHelp(command));
      return EXIT.ok;
    }
    return await command.run(args, io);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`isoloop ${command.path.join(' ')}: ${e.message}\n\n${commandHelp(command)}`);
    return EXIT.usage;
  }
}
