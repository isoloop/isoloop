/*
 * The CLI's argument parser: long flags (`--out file`, `--out=file`), short
 * aliases (`-o file`), boolean flags, positionals, and `--` to end the flags.
 * Our own, so the CLI has no framework dependency.
 */

/** One flag a command accepts. */
export type FlagSpec = {
  readonly type: 'string' | 'boolean';
  /** A one-letter alias, without the dash. */
  readonly short?: string;
  /** For the command's help. */
  readonly description: string;
  /** For the command's help: the value's name, e.g. `file`. */
  readonly value?: string;
};

/** The flags a command accepts, by long name. */
export type FlagSpecs = { readonly [name: string]: FlagSpec };

/** What {@link parseArgs} gives. */
export type ParsedArgs = {
  readonly positionals: readonly string[];
  readonly flags: { readonly [name: string]: string | true | undefined };
};

/** A command line that doesn't fit its spec, with a message for the user. */
export class UsageError extends Error {
  override readonly name: string = 'UsageError';
}

/** Parses `argv` against `specs`. Throws {@link UsageError} on an unknown flag or a missing value. */
export function parseArgs(argv: readonly string[], specs: FlagSpecs): ParsedArgs {
  const positionals: string[] = [];
  const flags: { [name: string]: string | true | undefined } = {};
  const byShort = new Map<string, string>();
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short !== undefined) byShort.set(spec.short, name);
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    let name: string | undefined;
    let inline: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
      inline = eq < 0 ? undefined : arg.slice(eq + 1);
    } else if (arg.length === 2 && arg.startsWith('-') && arg !== '-') {
      name = byShort.get(arg.slice(1));
      if (name === undefined) throw new UsageError(`unknown option ${arg}`);
    } else {
      positionals.push(arg);
      continue;
    }
    const spec = specs[name];
    if (spec === undefined) throw new UsageError(`unknown option --${name}`);
    if (spec.type === 'boolean') {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('-')) {
      throw new UsageError(`--${name} needs a value`);
    }
    flags[name] = next;
    i++;
  }
  return { positionals, flags };
}

/** The flags part of a command's help, one line each. */
export function flagsHelp(specs: FlagSpecs): string {
  const rows = Object.entries(specs).map(([name, spec]) => {
    const short = spec.short === undefined ? '    ' : `-${spec.short}, `;
    const value = spec.type === 'string' ? ` <${spec.value ?? 'value'}>` : '';
    return [`  ${short}--${name}${value}`, spec.description] as const;
  });
  const width = Math.max(0, ...rows.map(([left]) => left.length));
  return rows.map(([left, text]) => `${left.padEnd(width)}  ${text}`).join('\n');
}
