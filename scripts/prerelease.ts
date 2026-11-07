// Publishes every public @isoloop/* package as 0.0.0-next.<sha> under the
// `next` dist-tag (M3b task 1). A stopgap until M4's Changesets pipeline.
//
// CI runs it from .github/workflows/prerelease.yml, which npm trusts for each
// package (trusted publishing: no token, provenance is automatic). Run it with
// `--dry-run` locally to see what would be published.
//
// `pnpm pack` writes the tarball, so `workspace:*` and `catalog:` become real
// versions and `publishConfig` applies; `npm publish` uploads it, because npm
// is what speaks OIDC to the registry.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const run = (cmd: string, args: string[], cwd?: string, quiet = false): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
  }).trim();

const sha = (process.env.GITHUB_SHA ?? run('git', ['rev-parse', 'HEAD'])).slice(0, 7);
// A prerelease identifier that is all digits must not start with 0 (semver §9).
const id = /^\d+$/.test(sha) ? `g${sha}` : sha;
const version = `0.0.0-next.${id}`;

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

// Set every version first, so `pnpm pack` rewrites `workspace:*` to this one.
for (const p of packages) {
  p.manifest.version = version;
  writeFileSync(p.file, `${JSON.stringify(p.manifest, null, 2)}\n`);
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
