// The rules a stage run must pass (CONTRIBUTING.md, "Releases"), kept free of
// git, npm and GitHub so they can be tested.

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-next\.(\d+))?$/;
const REPOSITORY = 'git+https://github.com/isoloop/isoloop.git';

/**
 * The order the maintainer approves in: each group only depends on the groups
 * before it, so what's on npm installs at every step.
 */
export const APPROVAL_ORDER: readonly (readonly string[])[] = [
  ['@isoloop/protocol', '@isoloop/codec', '@isoloop/dom', '@isoloop/vite'],
  ['@isoloop/bus', '@isoloop/runtime'],
  ['@isoloop/host', '@isoloop/react', '@isoloop/preact'],
  ['@isoloop/balancer', '@isoloop/devtools', '@isoloop/webmcp', 'isoloop'],
];

export type DistTag = 'next' | 'latest';

/** `x.y.z`, with no suffix. */
export const isStable = (version: string): boolean => distTag(version) === 'latest';

/** The dist-tag a version gets, or `undefined` for one that's neither kind. */
export function distTag(version: string): DistTag | undefined {
  const m = VERSION.exec(version);
  if (!m) return undefined;
  return m[4] === undefined ? 'latest' : 'next';
}

function parts(version: string): number[] {
  const m = VERSION.exec(version);
  if (!m) throw new Error(`can't compare ${version}: not x.y.z or x.y.z-next.N`);
  // A release sorts after its prereleases.
  const pre = m[4] === undefined ? Infinity : Number(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), pre];
}

/** Semver order, for the two kinds of version Isoloop has. */
export function compare(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (const [i, n] of x.entries()) {
    const other = y[i] ?? 0;
    if (n !== other) return n > other ? 1 : -1;
  }
  return 0;
}

/** Packages missing from the approval order, or in it and not in the repo. */
export function orderProblems(names: string[]): string[] {
  const order = APPROVAL_ORDER.flat();
  return [
    ...names
      .filter((name) => !order.includes(name))
      .map((name) => `${name} isn't in the approval order (scripts/release/rules.ts).`),
    ...order
      .filter((name) => !names.includes(name))
      .map((name) => `${name} is in the approval order but isn't a public package.`),
  ];
}

/**
 * npm matches a trusted publisher against `repository.url`, so a wrong one
 * fails that package halfway through a stage.
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

/** What npm has of a package. */
export interface Registry {
  tags: Record<string, string>;
  versions: string[];
}

/** The GitHub environment `npm`, as the API describes it. */
export interface Environment {
  /** Custom branch policies only, as opposed to any branch or protected ones. */
  custom: boolean;
  policies: { name: string; type: string }[];
}

export interface Candidate {
  ref: string;
  version: string;
  /** `.changeset/pre.json`, or `undefined` when there isn't one. */
  pre: string | undefined;
  environment: Environment | undefined;
  registry: Map<string, Registry>;
}

/** Why this commit can't be staged. Empty when it can. */
export function stageProblems(candidate: Candidate): string[] {
  const { ref, version, pre, environment, registry } = candidate;
  const problems: string[] = [];
  if (ref !== 'refs/heads/main') problems.push(`stage runs on main only, not ${ref}.`);

  // A job that names a missing environment creates it, with no protection, so
  // this has to pass before the stage job starts.
  if (!environment) {
    problems.push('the GitHub environment `npm` is missing.');
  } else {
    const [only, ...others] = environment.policies;
    const mainOnly = only?.name === 'main' && only.type === 'branch' && others.length === 0;
    if (!environment.custom || !mainOnly) {
      problems.push('the GitHub environment `npm` must allow the branch main and nothing else.');
    }
  }

  const tag = distTag(version);
  if (!tag) {
    problems.push(`version ${version} is neither x.y.z nor x.y.z-next.N.`);
    return problems;
  }

  const mode: unknown = pre === undefined ? undefined : JSON.parse(pre);
  const inNext =
    typeof mode === 'object' &&
    mode !== null &&
    'mode' in mode &&
    mode.mode === 'pre' &&
    'tag' in mode &&
    mode.tag === 'next';
  if (tag === 'next' && !inNext) {
    problems.push(`${version} is a preview, so .changeset/pre.json must be in pre mode \`next\`.`);
  }
  if (tag === 'latest' && pre !== undefined) {
    problems.push(
      `${version} is a release, so .changeset/pre.json must be gone: \`pnpm changeset pre exit\`, then \`pnpm release:version\`.`,
    );
  }

  const published: string[] = [];
  const older: string[] = [];
  for (const [name, { tags, versions }] of registry) {
    if (versions.includes(version)) {
      published.push(name);
      continue;
    }
    // No patch of an older line until one is designed for, and no tag moves back.
    for (const at of new Set<DistTag>(['latest', tag])) {
      const current = tags[at];
      if (current !== undefined && compare(version, current) <= 0) {
        older.push(`${name} (${at} is ${current})`);
      }
    }
  }
  if (published.length > 0) {
    problems.push(`${version} is already on npm: ${published.join(', ')}.`);
  }
  if (older.length > 0) {
    problems.push(`${version} is older than what npm has: ${older.join(', ')}.`);
  }
  return problems;
}
