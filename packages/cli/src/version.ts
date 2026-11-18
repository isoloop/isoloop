import { readFileSync } from 'node:fs';

/** This package's version, from its package.json (one level above src/ and dist/). */
export function version(): string {
  const pkg: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const v: unknown =
    typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, 'version') : undefined;
  return typeof v === 'string' ? v : 'unknown';
}
