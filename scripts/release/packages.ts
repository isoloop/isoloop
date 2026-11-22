// The published packages as the two publish scripts see them
// (scripts/prerelease.ts and scripts/release.ts).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const run = (cmd: string, args: string[], cwd?: string, quiet = false): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
  }).trim();

export interface Manifest {
  name: string;
  private?: boolean;
  version: string;
  repository?: unknown;
}

export interface Package {
  dir: string;
  manifest: Manifest;
}

const isManifest = (v: unknown): v is Manifest =>
  typeof v === 'object' &&
  v !== null &&
  'name' in v &&
  typeof v.name === 'string' &&
  'version' in v &&
  typeof v.version === 'string';

/** Every package under `packages/` that isn't private. */
export function publicPackages(): Package[] {
  return readdirSync('packages', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const dir = join('packages', d.name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      } catch {
        return [];
      }
      return isManifest(parsed) && !parsed.private ? [{ dir, manifest: parsed }] : [];
    });
}

/** The fixed group's one version, as `changeset version` wrote it. */
export function sharedVersion(packages: Package[]): string {
  const versions = new Set(packages.map((p) => p.manifest.version));
  if (versions.size !== 1) {
    const list = packages.map((p) => `${p.manifest.name}@${p.manifest.version}`).join(', ');
    throw new Error(`the @isoloop/* packages disagree on their version: ${list}`);
  }
  const [version = ''] = versions;
  return version;
}

/**
 * `pnpm pack` writes the tarball, so `workspace:*` and `catalog:` become real
 * versions and `publishConfig` applies. Returns the tarball's path.
 */
export const pack = (dir: string, out: string): string =>
  run('pnpm', ['pack', '--pack-destination', out], dir).split('\n').pop() ?? '';
