// The published packages, read from the working tree or from a commit
// (scripts/release.ts). Only Node built-ins: the jobs that run this install
// nothing.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Runs a command and returns its output, trimmed. Never through a shell. */
export const run = (cmd: string, args: string[], cwd?: string): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();

/** A tree of the repo: the directories under `packages/`, and files by path. */
export interface Tree {
  packageDirs(): string[];
  /** A file's text, or `undefined` when it isn't there. */
  read(path: string): string | undefined;
}

export const workingTree: Tree = {
  packageDirs: () =>
    readdirSync('packages', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `packages/${d.name}`),
  read: (path) => {
    try {
      return readFileSync(join(path), 'utf8');
    } catch {
      return undefined;
    }
  },
};

/** The tree at a commit of this clone, read without checking it out. */
export function treeAt(commit: string): Tree {
  return {
    packageDirs: () =>
      run('git', ['ls-tree', '-d', '--name-only', commit, 'packages/']).split('\n').filter(Boolean),
    read: (path) => {
      const found = run('git', ['ls-tree', '--name-only', commit, '--', path]);
      return found === path ? run('git', ['show', `${commit}:${path}`]) : undefined;
    },
  };
}

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
export function publicPackages(tree: Tree): Package[] {
  return tree.packageDirs().flatMap((dir) => {
    const text = tree.read(`${dir}/package.json`);
    if (text === undefined) return [];
    const parsed: unknown = JSON.parse(text);
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

/** The file `pnpm pack` writes: `isoloop-host-0.1.0.tgz`. */
export const tarballName = (name: string, version: string): string =>
  `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
