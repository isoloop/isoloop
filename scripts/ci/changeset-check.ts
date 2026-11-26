// CI: decides what the Changeset workflow checks on a pull request
// (.github/workflows/changeset.yml, CONTRIBUTING.md "Releases").
// - Major guard: while the packages are below 1.0.0, a changeset the PR adds or
//   edits can't ask for `major`. On 0.x a breaking change is a minor; 1.0
//   starts only on a PR labelled `release-1.0`. It runs on every PR, labelled
//   `no-changeset` or not.
// - Codemod gate (ADR 0019, decision 10): a changeset whose summary starts
//   with `breaking:` fails unless the PR adds before/after fixtures under
//   `packages/cli/src/migrate/<version>/fixtures/`, for the release it ships
//   in. It runs on every PR too.
// - Then `changeset status` runs (the normal check), unless the PR has the
//   `no-changeset` label or is a version PR: one whose diff only consumes
//   changesets, as `pnpm release:version` writes it. That's told from the diff
//   alone, never from the branch name or the title.
// Writes `status=run` or `status=skip` to $GITHUB_OUTPUT for the next step.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RELEASE_LABEL = 'release-1.0';
export const SKIP_LABEL = 'no-changeset';

/** One line of `git diff --name-status --no-renames`. */
export interface Change {
  status: string;
  path: string;
}

/** A file's text on the merge base and on the PR, `undefined` where it doesn't exist. */
export type ReadPair = (path: string) => { base: string | undefined; head: string | undefined };

export type Decision =
  | { ok: false; error: string }
  | { ok: true; run: true; reason: string }
  | { ok: true; run: false; reason: string };

/** A pending changeset: `.changeset/<name>.md`, not the README, not under `pre/`. */
export const isChangeset = (path: string): boolean =>
  /^\.changeset\/[^/]+\.md$/.test(path) && !/^\.changeset\/readme\.md$/i.test(path);

/** The bumps a changeset's front matter asks for, by package name. */
export function bumps(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const front = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!front) return out;
  for (const line of (front[1] ?? '').split(/\r?\n/)) {
    const m = /^\s*(['"]?)([^'":\s]+)\1\s*:\s*(['"]?)(\w+)\3\s*$/.exec(line);
    if (m) out.set(m[2] ?? '', m[4] ?? '');
  }
  return out;
}

/** Below 1.0.0 in semver order: any 0.x, and 1.0.0's prereleases (1.0.0-next.N). */
export function belowOne(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
  if (!m) return false;
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return major === 0 || (major === 1 && minor === 0 && patch === 0 && m[4] !== undefined);
}

/** The changesets the PR adds or edits, with their text on the PR. */
export function pendingChangesets(
  changes: Change[],
  read: ReadPair,
): { path: string; text: string }[] {
  return changes
    .filter((c) => c.status !== 'D' && isChangeset(c.path))
    .map((c) => ({ path: c.path, text: read(c.path).head ?? '' }));
}

/** An error when a pending changeset asks for `major` below 1.0.0 without the label. */
export function majorProblem(
  version: string,
  changesets: { path: string; text: string }[],
  labels: string[],
): string | undefined {
  if (!belowOne(version) || labels.includes(RELEASE_LABEL)) return undefined;
  const majors = changesets.flatMap((c) =>
    [...bumps(c.text)]
      .filter(([, bump]) => bump === 'major')
      .map(([name]) => `${name} in ${c.path}`),
  );
  if (majors.length === 0) return undefined;
  return (
    `A changeset asks for a major bump (${majors.join(', ')}), but the packages are at ${version}, below 1.0.0. ` +
    `On 0.x a breaking change is a minor: change the bump to \`minor\`. ` +
    `1.0 starts only on a PR labelled \`${RELEASE_LABEL}\`.`
  );
}

/** Where the CLI's codemod steps live, one folder per release. */
export const MIGRATE_DIR = 'packages/cli/src/migrate';

/** A changeset's summary: its text after the front matter, trimmed. */
export function summaryOf(text: string): string {
  const front = /^\s*---\r?\n[\s\S]*?\r?\n---[^\n]*\n?/.exec(text);
  return (front ? text.slice(front[0].length) : text).trim();
}

/** A changeset for a breaking change: its summary starts with `breaking:`. */
export const isBreaking = (text: string): boolean => summaryOf(text).startsWith('breaking:');

/**
 * The release a breaking change on this branch ships in, as `major.minor`:
 * the release a prerelease leads to (`0.2.0-next.3` → `0.2`), otherwise the
 * next minor below 1.0 (a breaking change is a minor on 0.x), `1.0` on a PR
 * labelled `release-1.0`, and the next major from 1.0.
 */
export function migrationTarget(version: string, labels: string[]): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
  if (!m) throw new Error(`can't read the packages' version ${version}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (labels.includes(RELEASE_LABEL) && major === 0) return '1.0';
  if (m[4] !== undefined && patch === 0) return `${major}.${minor}`;
  return major === 0 ? `0.${minor + 1}` : `${major + 1}.0`;
}

/** An error when a pending changeset is `breaking:` and the PR adds no codemod fixtures for it. */
export function codemodProblem(
  version: string,
  changesets: { path: string; text: string }[],
  changes: Change[],
  labels: string[],
): string | undefined {
  const breaking = changesets.filter((c) => isBreaking(c.text)).map((c) => c.path);
  if (breaking.length === 0) return undefined;
  const target = migrationTarget(version, labels);
  const fixtures = `${MIGRATE_DIR}/${target}/fixtures/`;
  const has = changes.some(
    (c) => c.status !== 'D' && c.path.startsWith(fixtures) && /\.before\.[^/]+$/.test(c.path),
  );
  if (has) return undefined;
  return (
    `${breaking.join(', ')} ${breaking.length === 1 ? 'is a' : 'are'} \`breaking:\` changeset${breaking.length === 1 ? '' : 's'}, ` +
    `but the PR adds no codemod fixtures for ${target}. A breaking change ships with a codemod: ` +
    `add its step to ${MIGRATE_DIR}/${target}/step.ts and a before/after pair under ${fixtures} ` +
    `(CONTRIBUTING.md, "Releases").`
  );
}

/** A manifest's text without its `version`, or undefined when it isn't a JSON object. */
function withoutVersion(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    Reflect.deleteProperty(parsed, 'version');
    return JSON.stringify(parsed);
  } catch {
    return undefined;
  }
}

/** Both manifests parse and differ only in `version`. */
function onlyVersion(base: string | undefined, head: string | undefined): boolean {
  if (base === undefined || head === undefined) return false;
  const a = withoutVersion(base);
  return a !== undefined && a === withoutVersion(head);
}

/** A change `pnpm release:version` makes, and nothing else. */
function versionChange(c: Change, read: ReadPair): boolean {
  if (isChangeset(c.path)) return c.status === 'A' || c.status === 'D';
  if (c.path.startsWith('.changeset/pre/') || c.path === '.changeset/pre.json') return true;
  if (/^packages\/[^/]+\/CHANGELOG\.md$/.test(c.path)) return true;
  if (/^packages\/[^/]+\/package\.json$/.test(c.path) && c.status === 'M') {
    const { base, head } = read(c.path);
    return onlyVersion(base, head);
  }
  return false;
}

/**
 * A version PR: the diff only consumes changesets. Added or deleted
 * `.changeset/*.md`, anything under `.changeset/pre/`, `.changeset/pre.json`,
 * `packages/*\/CHANGELOG.md`, and `packages/*\/package.json` where only
 * `version` changed. An empty diff isn't one.
 */
export function isVersionPr(changes: Change[], read: ReadPair): boolean {
  return changes.length > 0 && changes.every((c) => versionChange(c, read));
}

/** What the workflow does with this PR. */
export function decide(input: {
  version: string;
  labels: string[];
  changes: Change[];
  read: ReadPair;
}): Decision {
  const { version, labels, changes, read } = input;
  const pending = pendingChangesets(changes, read);
  const problem =
    majorProblem(version, pending, labels) ?? codemodProblem(version, pending, changes, labels);
  if (problem) return { ok: false, error: problem };
  if (labels.includes(SKIP_LABEL)) {
    return { ok: true, run: false, reason: `Internal-only change, labelled ${SKIP_LABEL}.` };
  }
  if (isVersionPr(changes, read)) {
    return { ok: true, run: false, reason: 'A version PR: it only consumes changesets.' };
  }
  return { ok: true, run: true, reason: 'Running `changeset status`.' };
}

/** `git diff --name-status --no-renames` output, as changes. */
export function parseNameStatus(out: string): Change[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status = '', path = ''] = line.split('\t');
      return { status: status.slice(0, 1), path };
    });
}

const git = (args: string[]): string =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 28,
  });

const show = (rev: string, path: string): string | undefined => {
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
};

const get = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined;

/** The PR's labels from the event payload, or `PR_LABELS` (comma-separated) when run by hand. */
function prLabels(): string[] {
  const fromEnv = process.env['PR_LABELS'];
  if (fromEnv !== undefined) {
    return fromEnv
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
  }
  const path = process.env['GITHUB_EVENT_PATH'];
  if (!path) return [];
  const event: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const labels = get(get(event, 'pull_request'), 'labels');
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((l: unknown) => {
    const name = get(l, 'name');
    return typeof name === 'string' ? [name] : [];
  });
}

/** The fixed group's version on the PR, from the public packages' manifests. */
function packagesVersion(): string {
  const versions = new Set<string>();
  for (const d of readdirSync('packages', { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join('packages', d.name, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    if (Reflect.get(parsed, 'private') === true) continue;
    const version: unknown = Reflect.get(parsed, 'version');
    if (typeof version === 'string') versions.add(version);
  }
  if (versions.size !== 1) {
    throw new Error(
      `the @isoloop/* packages disagree on their version: ${[...versions].join(', ')}`,
    );
  }
  return [...versions][0] ?? '';
}

function output(key: string, value: string): void {
  const file = process.env['GITHUB_OUTPUT'];
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

function summary(text: string): void {
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (file) appendFileSync(file, `${text}\n`);
}

if (import.meta.main) {
  const since = process.env['BASE_REF'] ?? 'origin/main';
  const base = git(['merge-base', since, 'HEAD']).trim();
  const changes = parseNameStatus(git(['diff', '--name-status', '--no-renames', base, 'HEAD']));
  const result = decide({
    version: packagesVersion(),
    labels: prLabels(),
    changes,
    read: (path) => ({ base: show(base, path), head: show('HEAD', path) }),
  });
  if (!result.ok) {
    console.error(`::error title=Changeset::${result.error}`);
    summary(`**Changeset:** ${result.error}`);
    process.exitCode = 1;
  } else {
    console.log(result.reason);
    summary(`**Changeset:** ${result.reason}`);
    output('status', result.run ? 'run' : 'skip');
  }
}
