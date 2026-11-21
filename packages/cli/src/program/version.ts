import { version as packageVersion } from '../../package.json';

/** This package's version, from its package.json, which the build inlines. */
export function version(): string {
  return packageVersion;
}
