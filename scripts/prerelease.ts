// Publishes every public @isoloop/* package at the version Changesets wrote
// into its package.json, under the `next` dist-tag. The versions come from
// `pnpm release:version` (pre mode `next`, so 0.1.0-next.N), merged to main
// through a PR before this runs; every package shares one version (the fixed
// group, ADR 0011). A version already on npm is skipped, so a re-run is safe.
//
// CI runs it from .github/workflows/prerelease.yml, which npm trusts for each
// package (trusted publishing: no token, provenance is automatic). Run it with
// `--dry-run` locally to see what would be published.
//
// In CI it writes the version to $GITHUB_OUTPUT once every package is on npm,
// and the workflow's `tag` job tags the commit `v<version>`.
//
// `pnpm pack` writes the tarball, so `workspace:*` and `catalog:` become real
// versions and `publishConfig` applies; `npm publish` uploads it, because npm
// is what speaks OIDC to the registry.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const run = (cmd: string, args: string[], cwd?: string, quiet = false): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
  }).trim();

interface Manifest {
  name: string;
  private?: boolean;
  version: string;
}

const isManifest = (v: unknown): v is Manifest =>
  typeof v === 'object' &&
  v !== null &&
  'name' in v &&
  typeof v.name === 'string' &&
  'version' in v &&
  typeof v.version === 'string';

const dirs = readdirSync('packages', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join('packages', d.name));
const packages = dirs.flatMap((dir) => {
  const file = join(dir, 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!isManifest(parsed)) return [];
  const manifest = parsed;
  return manifest.private ? [] : [{ dir, file, manifest }];
});

// One version for the whole fixed group, written by `changeset version`.
const versions = new Set(packages.map((p) => p.manifest.version));
if (versions.size !== 1) {
  const list = packages.map((p) => `${p.manifest.name}@${p.manifest.version}`).join(', ');
  throw new Error(`the @isoloop/* packages disagree on their version: ${list}`);
}
const [version = ''] = versions;
if (!/^\d+\.\d+\.\d+-next\.\d+$/.test(version)) {
  throw new Error(
    `version ${version} isn't a next prerelease: run \`pnpm release:version\` and merge its PR first`,
  );
}

const out = mkdtempSync(join(tmpdir(), 'isoloop-next-'));
for (const p of packages) {
  const name = p.manifest.name;
  const exists = (() => {
    try {
      return run('npm', ['view', `${name}@${version}`, 'version'], undefined, true) === version;
    } catch {
      return false;
    }
  })();
  if (exists) {
    console.log(`= ${name}@${version} already published`);
    continue;
  }
  const tarball = run('pnpm', ['pack', '--pack-destination', out], p.dir).split('\n').pop() ?? '';
  const args = ['publish', tarball, '--tag', 'next', '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  run('npm', args);
  console.log(`${dryRun ? '~' : '+'} ${name}@${version}`);
}

// Every package is on npm at this version: the workflow tags the commit.
const output = process.env['GITHUB_OUTPUT'];
if (output && !dryRun) appendFileSync(output, `version=${version}\n`);
