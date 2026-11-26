/*
 * The `@isoloop/*` version a project has installed, which is where
 * `isoloop migrate` starts: the nearest `node_modules/@isoloop/` from the
 * working directory up, read package by package.
 */
import { dirname, join } from 'node:path';
import type { Io } from '../program/io';

export type Installed = {
  /** The folder whose `node_modules` holds them. */
  readonly dir: string;
  /** Each package's version, by name. */
  readonly versions: ReadonlyMap<string, string>;
};

const versionIn = (json: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const v: unknown = Reflect.get(parsed, 'version');
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
};

/** The installed `@isoloop/*` packages nearest to `from`, or `undefined` when there are none. */
export async function installed(io: Io, from: string): Promise<Installed | undefined> {
  for (let dir = from; ; dir = dirname(dir)) {
    const scope = join(dir, 'node_modules', '@isoloop');
    // oxlint-disable-next-line no-await-in-loop -- up the tree, one folder at a time
    const entries = await io.list(scope);
    const versions = new Map<string, string>();
    for (const e of entries ?? []) {
      // oxlint-disable-next-line no-await-in-loop -- a dozen small files
      const json = await io.readFile(join(scope, e.name, 'package.json'));
      const v = json === undefined ? undefined : versionIn(json);
      if (v !== undefined) versions.set(`@isoloop/${e.name}`, v);
    }
    if (versions.size > 0) return { dir, versions };
    if (dirname(dir) === dir) return undefined;
  }
}
