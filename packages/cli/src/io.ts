/*
 * What a command touches outside itself, so tests can run it in-process:
 * output streams, the working directory, files and module loading.
 */
import { writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type Io = {
  /** Writes to stdout as is. */
  readonly out: (text: string) => void;
  /** Writes to stderr as is. */
  readonly err: (text: string) => void;
  readonly cwd: string;
  readonly writeFile: (path: string, text: string) => Promise<void>;
  /** Imports a module by absolute path. */
  readonly load: (path: string) => Promise<unknown>;
};

/** A path from the command line, resolved against `cwd`. */
export const resolvePath = (io: Io, path: string): string =>
  isAbsolute(path) ? path : resolve(io.cwd, path);

/** The real process's streams and files. */
export function nodeIo(): Io {
  return {
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    cwd: process.cwd(),
    writeFile: (path, text) => writeFile(path, text, 'utf8'),
    load: (path) => import(pathToFileURL(path).href),
  };
}
