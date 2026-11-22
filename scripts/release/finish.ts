// The `finish` run's checks: what a stage run staged is what's on npm. The
// provenance is read from the attestation the registry serves; its signature
// isn't verified again here.
import { list, record, text, type Npm } from './npm.ts';
import { publicPackages, sharedVersion, tarballName, type Tree } from './packages.ts';
import { distTag } from './rules.ts';

export const REPO = 'isoloop/isoloop';
export const WORKFLOW = '.github/workflows/release.yml';
const SERVER = 'https://github.com';

/** One package in the record a stage job uploads, `staged-<attempt>`. */
export interface Staged {
  name: string;
  file: string;
  sha1: string;
  /** Hex, as in the provenance's subject. */
  sha512: string;
}

export interface StageRecord {
  run: string;
  commit: string;
  version: string;
  tag: string;
  packages: Staged[];
}

export function parseRecord(json: string): StageRecord {
  const doc = record(JSON.parse(json));
  return {
    run: text(doc['run']),
    commit: text(doc['commit']),
    version: text(doc['version']),
    tag: text(doc['tag']),
    packages: list(doc['packages']).map((entry) => {
      const pkg = record(entry);
      return {
        name: text(pkg['name']),
        file: text(pkg['file']),
        sha1: text(pkg['sha1']),
        sha512: text(pkg['sha512']),
      };
    }),
  };
}

/** Why the run `id` isn't a finished stage run of release.yml on main. */
export function runProblems(run: unknown, jobs: unknown, id: string): string[] {
  const doc = record(run);
  const problems: string[] = [];
  const expect = (what: string, got: unknown, want: string): void => {
    if (got !== want) problems.push(`run ${id}: ${what} is ${JSON.stringify(got)}, not ${want}.`);
  };
  expect('its workflow', text(doc['path']).split('@')[0], WORKFLOW);
  expect('its event', doc['event'], 'workflow_dispatch');
  expect('its branch', doc['head_branch'], 'main');
  expect('its repository', record(doc['head_repository'])['full_name'], REPO);
  expect('its status', doc['status'], 'completed');
  expect('its conclusion', doc['conclusion'], 'success');
  const stage = list(record(jobs)['jobs'])
    .map(record)
    .find((job) => job['name'] === 'stage');
  if (stage?.['conclusion'] !== 'success') {
    problems.push(`run ${id}: it has no successful stage job, so it staged nothing (a dry run?).`);
  }
  if (!/^[0-9a-f]{40}$/.test(text(doc['head_sha']))) {
    problems.push(`run ${id}: it has no commit.`);
  }
  return problems;
}

/** The record of the latest attempt that staged everything, by artifact name. */
export function recordName(artifacts: unknown): string | undefined {
  const attempts = list(record(artifacts)['artifacts'])
    .map(record)
    .filter((artifact) => artifact['expired'] === false)
    .map((artifact) => /^staged-(\d+)$/.exec(text(artifact['name']))?.[1])
    .flatMap((attempt) => (attempt === undefined ? [] : [Number(attempt)]));
  return attempts.length === 0 ? undefined : `staged-${Math.max(...attempts)}`;
}

/** Why the record doesn't describe that run's commit. */
export function recordProblems(
  staged: StageRecord,
  id: string,
  commit: string,
  tree: Tree,
): string[] {
  const packages = publicPackages(tree);
  const version = sharedVersion(packages);
  const problems: string[] = [];
  if (staged.run !== id) problems.push(`the record is of run ${staged.run}, not ${id}.`);
  if (staged.commit !== commit) {
    problems.push(`the record is of commit ${staged.commit}, not ${commit}.`);
  }
  if (staged.version !== version) {
    problems.push(`the record is of ${staged.version}, and the commit's packages are ${version}.`);
  }
  if (staged.tag !== distTag(version)) {
    problems.push(`the record's dist-tag ${staged.tag} isn't ${version}'s.`);
  }
  const want = new Set(packages.map(({ manifest }) => manifest.name));
  const got = new Set(staged.packages.map(({ name }) => name));
  const same = got.size === staged.packages.length && got.size === want.size;
  if (!same || [...want].some((name) => !got.has(name))) {
    problems.push('the record and the commit have different packages.');
  }
  for (const { name, file, sha1, sha512 } of staged.packages) {
    const shaped = /^[0-9a-f]{40}$/.test(sha1) && /^[0-9a-f]{128}$/.test(sha512);
    if (!shaped || file !== tarballName(name, version)) {
      problems.push(`the record's entry for ${name} is broken.`);
    }
  }
  return problems;
}

/** The SLSA provenance statement in a version's attestations. */
function provenance(attestations: unknown): Record<string, unknown> | undefined {
  const found = list(record(attestations)['attestations'])
    .map(record)
    .find((a) => a['predicateType'] === 'https://slsa.dev/provenance/v1');
  if (!found) return undefined;
  const payload = record(record(found['bundle'])['dsseEnvelope'])['payload'];
  return record(JSON.parse(Buffer.from(text(payload), 'base64').toString('utf8')));
}

/** Why one package on npm isn't what that run staged. */
export function publishedProblems(
  staged: StageRecord,
  pkg: Staged,
  packument: unknown,
  attestations: unknown,
): string[] {
  const { version, tag, commit, run } = staged;
  const { name } = pkg;
  const doc = record(packument);
  const published = record(doc['versions'])[version];
  if (published === undefined) return [`${name}@${version} isn't on npm (not approved yet?).`];

  const problems: string[] = [];
  const at = record(doc['dist-tags'])[tag];
  if (at !== version) problems.push(`${name}: the dist-tag ${tag} is ${text(at)}, not ${version}.`);

  const dist = record(record(published)['dist']);
  if (dist['shasum'] !== pkg.sha1) {
    problems.push(`${name}: npm's shasum isn't the one run ${run} staged.`);
  }
  const integrity = `sha512-${Buffer.from(pkg.sha512, 'hex').toString('base64')}`;
  if (dist['integrity'] !== integrity) {
    problems.push(`${name}: npm's integrity isn't the one run ${run} staged.`);
  }

  const statement = provenance(attestations);
  if (!statement) return [...problems, `${name}@${version} has no provenance.`];

  const predicate = record(statement['predicate']);
  const build = record(predicate['buildDefinition']);
  const workflow = record(record(build['externalParameters'])['workflow']);
  const facts: [string, unknown, string][] = [
    ['repository', workflow['repository'], `${SERVER}/${REPO}`],
    ['workflow', workflow['path'], WORKFLOW],
    ['ref', workflow['ref'], 'refs/heads/main'],
    [
      'commit',
      record(record(list(build['resolvedDependencies'])[0])['digest'])['gitCommit'],
      commit,
    ],
    ['subject', record(record(list(statement['subject'])[0])['digest'])['sha512'], pkg.sha512],
  ];
  for (const [what, got, want] of facts) {
    if (got !== want) problems.push(`${name}: the provenance's ${what} isn't ${want}.`);
  }
  // Any attempt of that run: a stage job that was re-run is attempt 2 or later.
  const invocation = text(record(record(predicate['runDetails'])['metadata'])['invocationId']);
  if (!invocation.startsWith(`${SERVER}/${REPO}/actions/runs/${run}/attempts/`)) {
    problems.push(`${name}: the provenance's run isn't ${run}.`);
  }
  return problems;
}

/** What `finish` reads, as a seam for the tests. */
export interface Sources {
  /** A GitHub API path under the repo. */
  github(path: string): unknown;
  /** The text of a run's record artifact. */
  stagedRecord(run: string, artifact: string): string;
  tree(commit: string): Tree;
  /** Whether `.github/workflows` at that commit differs from this run's. */
  workflowsChanged(commit: string): boolean;
  npm: Npm;
}

export interface Finished {
  commit: string;
  tag: string;
  version: string;
}

const fail = (problems: string[]): void => {
  if (problems.length > 0) throw new Error(`can't finish:\n${problems.join('\n')}`);
};

/** Checks a stage run against npm. Throws everything that's wrong at once. */
export async function checkFinish(ref: string, id: string, from: Sources): Promise<Finished> {
  if (ref !== 'refs/heads/main') fail([`finish runs on main only, not ${ref}.`]);
  if (!/^\d+$/.test(id)) fail([`"${id}" isn't a run id.`]);

  const run = from.github(`actions/runs/${id}`);
  fail(runProblems(run, from.github(`actions/runs/${id}/jobs?filter=latest&per_page=100`), id));
  const commit = text(record(run)['head_sha']);

  const artifact = recordName(from.github(`actions/runs/${id}/artifacts?per_page=100`));
  if (!artifact) throw new Error(`can't finish:\nrun ${id} has no staged-<attempt> artifact.`);
  const staged = parseRecord(from.stagedRecord(id, artifact));
  fail(recordProblems(staged, id, commit, from.tree(commit)));

  const checked = await Promise.all(
    staged.packages.map(async (pkg) =>
      publishedProblems(
        staged,
        pkg,
        await from.npm.packument(pkg.name),
        await from.npm.attestations(pkg.name, staged.version),
      ),
    ),
  );
  fail(checked.flat());

  const tag = `v${staged.version}`;
  const tagged = list(from.github(`git/matching-refs/tags/${tag}`))
    .map(record)
    .some((found) => found['ref'] === `refs/tags/${tag}`);
  // The token can't create a tag on a commit whose workflows differ from main's.
  if (!tagged && from.workflowsChanged(commit)) {
    fail([
      `.github/workflows changed since ${commit}, so the token can't tag it. No workflow change merges between a stage and its finish.`,
    ]);
  }
  return { commit, tag, version: staged.version };
}
