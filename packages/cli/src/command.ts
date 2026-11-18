import type { FlagSpecs, ParsedArgs } from './args';
import type { Io } from './io';

/**
 * One CLI command. `path` is its words (`['contracts', 'export']`), so later
 * commands (`mcp`, `skill add`) are one more entry in the list in `main.ts`.
 */
export type Command = {
  readonly path: readonly string[];
  /** One line, for `isoloop --help`. */
  readonly summary: string;
  /** What follows the command's words in its usage line, e.g. `<module>`. */
  readonly usage: string;
  /** More help, after the usage line. */
  readonly details?: string;
  readonly flags: FlagSpecs;
  /** Returns the exit code. */
  readonly run: (args: ParsedArgs, io: Io) => Promise<number>;
};

/** Exit codes: done, the command failed, the command line was wrong. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;
