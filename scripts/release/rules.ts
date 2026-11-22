// The rules a release must pass (ADR 0019, decisions 5 and 6), kept free of
// git and npm so they can be tested.

const PLAIN = /^(\d+)\.(\d+)\.(\d+)$/;
const REPOSITORY = 'git+https://github.com/isoloop/isoloop.git';

/** `x.y.z`, with no suffix. */
export const isPlain = (version: string): boolean => PLAIN.test(version);

const triple = (version: string): [number, number, number] => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`${version} isn't a version`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/** The branch that patches this version's minor line: `release/0.1` for 0.1.2. */
export function releaseBranch(version: string): string {
  const [major, minor] = triple(version);
  return `release/${major}.${minor}`;
}

export interface Candidate {
  /** The tag pushed, e.g. `v0.1.0`. */
  tag: string;
  /** The packages' shared version. */
  version: string;
  /** `.changeset/pre.json` exists: pre mode, or left and not versioned since. */
  preMode: boolean;
  /** The branches on origin that contain the commit, without `origin/`. */
  branches: string[];
}

/** Why this commit can't be released. Empty when it can. */
export function releaseProblems({ tag, version, preMode, branches }: Candidate): string[] {
  const problems: string[] = [];
  if (!isPlain(version)) {
    problems.push(`version ${version} isn't a release (x.y.z, no suffix).`);
  }
  if (tag !== `v${version}`) {
    problems.push(`the tag ${tag} doesn't match the packages' version ${version}.`);
  }
  if (preMode) {
    problems.push(
      '.changeset/pre.json exists: run `pnpm changeset pre exit`, then `pnpm release:version`, and merge that first.',
    );
  }
  const allowed = ['main', releaseBranch(version)];
  if (!branches.some((b) => allowed.includes(b))) {
    problems.push(`the commit is on neither ${allowed.join(' nor ')}.`);
  }
  return problems;
}

/**
 * npm matches a trusted publisher against `repository.url`, so a wrong one
 * fails that package halfway through a release.
 */
export function repositoryProblems(packages: { name: string; repository?: unknown }[]): string[] {
  return packages.flatMap(({ name, repository }) => {
    const url =
      typeof repository === 'object' && repository !== null && 'url' in repository
        ? repository.url
        : undefined;
    return url === REPOSITORY ? [] : [`${name}: repository.url must be ${REPOSITORY}.`];
  });
}

/**
 * The npm dist-tag for a release. `latest` never moves back: a patch of an
 * older line gets `release-<major>.<minor>`. Publishing with an explicit
 * `--tag` turns npm's own downgrade check off, so this is the check.
 */
export function distTag(version: string, latest: string | undefined): string {
  if (latest === undefined) return 'latest';
  const next = triple(version);
  const current = triple(latest);
  const i = next.findIndex((n, at) => n !== current[at]);
  if (i === -1 || (next[i] ?? 0) > (current[i] ?? 0)) return 'latest';
  return `release-${next[0]}.${next[1]}`;
}
