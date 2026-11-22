// A release (x.y.z), for .github/workflows/release.yml. Prereleases are
// scripts/prerelease.ts's.
//
//   node scripts/release.ts check [--dry-run]    the release's rules and its notes
//   node scripts/release.ts publish [--dry-run]  every package, to npm
//   node scripts/release.ts notes <file>         the GitHub Release's body
//
// `--dry-run` runs on any commit, prerelease versions included: it reports
// what would stop a release instead of failing on it, and it passes
// `--dry-run` to npm. Without it, `publish` runs only for a pushed tag, and
// checks the rules again first. A version already on npm is skipped, so a
// re-run after a partial failure finishes the release.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Changelog, releaseNotes } from './release/notes.ts';
import { pack, publicPackages, run, sharedVersion } from './release/packages.ts';
import { distTag, isPlain, releaseProblems, repositoryProblems } from './release/rules.ts';

const [command, ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');
const env = process.env;

const packages = publicPackages();
const version = sharedVersion(packages);

const notes = (): string => {
  const changelogs: Changelog[] = packages.map(({ dir, manifest }) => {
    const file = join(dir, 'CHANGELOG.md');
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    return { name: manifest.name, dir, text };
  });
  return releaseNotes(version, changelogs, 'https://github.com/isoloop/isoloop');
};

const summary = (text: string): void => {
  console.log(text);
  const file = env['GITHUB_STEP_SUMMARY'];
  if (file) appendFileSync(file, `${text}\n`);
};

function check(): void {
  const broken = repositoryProblems(packages.map((p) => p.manifest));
  if (broken.length > 0) throw new Error(broken.join('\n'));
  const branches = run('git', [
    'for-each-ref',
    '--contains',
    'HEAD',
    '--format=%(refname:strip=3)',
    'refs/remotes/origin',
  ]).split('\n');
  const problems = releaseProblems({
    // A dry run has no tag: it checks the one this commit would get.
    tag: dryRun ? `v${version}` : (env['GITHUB_REF_NAME'] ?? ''),
    version,
    preMode: existsSync(join('.changeset', 'pre.json')),
    branches,
  });
  if (!dryRun && problems.length > 0) {
    throw new Error(`can't release ${version}:\n${problems.join('\n')}`);
  }
  if (dryRun) {
    const list = problems.map((problem) => `- ${problem}`).join('\n');
    summary(
      problems.length === 0
        ? `Dry run: ${version} passes a release's checks.\n`
        : `Dry run: pushing v${version} as a release would fail here, because:\n\n${list}\n`,
    );
  }
}

interface OnNpm {
  latest: string | undefined;
  published: boolean;
}

/**
 * What npm has of a package. Unlike the prerelease script, a failed read is an
 * error: guessing here could move `latest` back.
 */
function onNpm(name: string): OnNpm {
  const read: unknown = JSON.parse(
    run('npm', ['view', name, 'dist-tags', 'versions', '--json', '--prefer-online']),
  );
  if (
    typeof read !== 'object' ||
    read === null ||
    !('dist-tags' in read) ||
    !('versions' in read)
  ) {
    throw new Error(`npm view ${name} returned no dist-tags and versions`);
  }
  const { 'dist-tags': tags, versions } = read;
  const latest =
    typeof tags === 'object' && tags !== null && 'latest' in tags ? tags.latest : undefined;
  return {
    latest: typeof latest === 'string' ? latest : undefined,
    published: Array.isArray(versions) ? versions.includes(version) : versions === version,
  };
}

function publish(): void {
  if (!dryRun && (env['GITHUB_EVENT_NAME'] !== 'push' || env['GITHUB_REF_TYPE'] !== 'tag')) {
    throw new Error('a release publishes only from a pushed tag; use --dry-run to try it');
  }
  check();
  // All of it is read before the first publish, so a failed read publishes nothing.
  const plan = packages.map(({ dir, manifest }) => {
    const { latest, published } = onNpm(manifest.name);
    return { dir, manifest, published, tag: distTag(version, latest) };
  });
  const out = mkdtempSync(join(tmpdir(), 'isoloop-release-'));
  for (const { dir, manifest, published, tag } of plan) {
    const id = `${manifest.name}@${version}`;
    if (published && !dryRun) {
      console.log(`= ${id} already published`);
      continue;
    }
    const tarball = pack(dir, out);
    if (published && isPlain(version)) {
      // npm refuses to dry-run over a published release, so packing is all there is to try.
      summary(`= ${id} already published, packed only`);
      continue;
    }
    // npm won't take a prerelease version without its own tag, dry run or not.
    const npmTag = isPlain(version) ? tag : 'next';
    const args = ['publish', tarball, '--tag', npmTag, '--access', 'public'];
    if (dryRun) args.push('--dry-run');
    run('npm', args);
    const was = published ? ' (already on npm)' : '';
    if (dryRun) summary(`- would publish ${id}${was}; a release of it would be tagged ${tag}`);
    else console.log(`+ ${id} (${tag})`);
  }
  const output = env['GITHUB_OUTPUT'];
  // Whether this release is the newest, for the GitHub Release and Pages.
  if (output && !dryRun) {
    appendFileSync(output, `latest=${plan.every((p) => p.tag === 'latest')}\n`);
  }
}

if (command === 'check') {
  check();
  const body = notes();
  summary(`${dryRun ? `The release notes ${version} would get:\n\n` : ''}${body}`);
} else if (command === 'publish') {
  publish();
} else if (command === 'notes' && rest[0]) {
  writeFileSync(rest[0], notes());
} else {
  throw new Error('usage: release.ts check [--dry-run] | publish [--dry-run] | notes <file>');
}
