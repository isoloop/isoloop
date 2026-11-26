/*
 * How a project lays out its code, for steps that write new code: the line
 * width and the indent its formatter uses. Read from the nearest oxfmt or
 * Prettier config above a file, so a file the formatter is happy with stays
 * that way. Only the layout a step itself writes uses it.
 */
import { dirname, join, relative, sep } from 'node:path';
import type { Io } from '../program/io';

/** The layout a step writes new code in. */
export type Style = {
  /** The line width the formatter wraps at. */
  readonly printWidth: number;
  /** One level of indentation: spaces or a tab. */
  readonly indent: string;
  /** How wide a tab counts when measuring a line. */
  readonly tabWidth: number;
  /** A call's arguments, one per line, end with a comma (`trailingComma: 'all'`). */
  readonly trailingComma: boolean;
};

/** Prettier's defaults, for a project with no formatter config. */
export const DEFAULT_STYLE: Style = {
  printWidth: 80,
  indent: '  ',
  tabWidth: 2,
  trailingComma: true,
};

/** oxfmt's defaults, for an oxfmt config that leaves a field out. */
const OXFMT: Style = { ...DEFAULT_STYLE, printWidth: 100 };

/** The config files read, nearest first in each folder, with the defaults they fall back to. */
const CONFIGS: readonly { readonly name: string; readonly base: Style; readonly key?: string }[] = [
  { name: '.oxfmtrc.json', base: OXFMT },
  { name: '.oxfmtrc.jsonc', base: OXFMT },
  { name: '.prettierrc', base: DEFAULT_STYLE },
  { name: '.prettierrc.json', base: DEFAULT_STYLE },
  { name: 'package.json', base: DEFAULT_STYLE, key: 'prettier' },
];

/** JSON, with `//` and `/* *\/` comments and trailing commas allowed; `undefined` when it isn't. */
function parseJsonc(text: string): unknown {
  const stripped = text
    .replace(
      /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      (m, str: string | undefined) => str ?? '',
    )
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

const field = (o: unknown, name: string): unknown =>
  typeof o === 'object' && o !== null ? Reflect.get(o, name) : undefined;

/** The style a config object sets over `base`. */
function styleOf(config: unknown, base: Style): Style {
  const width = field(config, 'printWidth');
  const tabs = field(config, 'useTabs');
  const size = field(config, 'tabWidth');
  const comma = field(config, 'trailingComma');
  const tabWidth = typeof size === 'number' && size > 0 ? size : base.tabWidth;
  return {
    printWidth: typeof width === 'number' && width > 0 ? width : base.printWidth,
    indent: tabs === true ? '\t' : ' '.repeat(tabWidth),
    tabWidth,
    trailingComma: typeof comma === 'string' ? comma === 'all' : base.trailingComma,
  };
}

/**
 * The style for the file at `abs`: the nearest config in its folder or one
 * above it, up to `root`. {@link DEFAULT_STYLE} when there's none. `cache`
 * holds each folder's answer.
 */
export async function styleFor(
  io: Io,
  root: string,
  abs: string,
  cache: Map<string, Style>,
): Promise<Style> {
  const seen: string[] = [];
  let dir = dirname(abs);
  let found: Style | undefined;
  for (;;) {
    const known = cache.get(dir);
    if (known !== undefined) {
      found = known;
      break;
    }
    seen.push(dir);
    for (const c of CONFIGS) {
      // oxlint-disable-next-line no-await-in-loop -- the first config found wins
      const text = await io.readFile(join(dir, c.name));
      if (text === undefined) continue;
      const parsed = parseJsonc(text);
      const config = c.key === undefined ? parsed : field(parsed, c.key);
      if (config === undefined) continue;
      found = styleOf(config, c.base);
      break;
    }
    if (found !== undefined) break;
    const up = dirname(dir);
    const rel = relative(root, dir);
    if (up === dir || rel === '' || rel.startsWith('..') || rel.split(sep)[0] === '..') break;
    dir = up;
  }
  const style = found ?? DEFAULT_STYLE;
  for (const d of seen) cache.set(d, style);
  return style;
}
