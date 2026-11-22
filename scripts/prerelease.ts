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
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, publicPackages, run, sharedVersion } from './release/packages.ts';

const dryRun = process.argv.includes('--dry-run');
const packages = publicPackages();
// One version for the whole fixed group, written by `changeset version`.
const version = sharedVersion(packages);
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
  const tarball = pack(p.dir, out);
  const args = ['publish', tarball, '--tag', 'next', '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  run('npm', args);
  console.log(`${dryRun ? '~' : '+'} ${name}@${version}`);
}

// Every package is on npm at this version: the workflow tags the commit.
const output = process.env['GITHUB_OUTPUT'];
if (output && !dryRun) appendFileSync(output, `version=${version}\n`);
