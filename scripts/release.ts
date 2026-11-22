// The scripts behind .github/workflows/release.yml (CONTRIBUTING.md,
// "Releases"). Only Node built-ins: the jobs that run them install nothing.
//
//   node scripts/release.ts check [--stage]  can this commit be staged, and its notes
//   node scripts/release.ts pack <dir>       the tarballs and their shasums
//   node scripts/release.ts finish <run id>  is what that run staged on npm
//
// `check` reports, and with `--stage` fails on, what would stop a stage. The
// stage itself is inline in the workflow: that job checks out nothing.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkFinish, REPO, type Sources } from './release/finish.ts';
import { releaseNotes } from './release/notes.ts';
import { list, npm, record, registryOf, text } from './release/npm.ts';
import {
  publicPackages,
  run,
  sharedVersion,
  tarballName,
  treeAt,
  type Tree,
  workingTree,
} from './release/packages.ts';
import {
  APPROVAL_ORDER,
  distTag,
  type Environment,
  isStable,
  orderProblems,
  type Registry,
  repositoryProblems,
  stageProblems,
} from './release/rules.ts';

const env = process.env;

const summary = (markdown: string): void => {
  console.log(markdown);
  const file = env['GITHUB_STEP_SUMMARY'];
  if (file) appendFileSync(file, `${markdown}\n`);
};

const output = (name: string, value: string): void => {
  const file = env['GITHUB_OUTPUT'];
  if (!file) return;
  // A delimiter the value can't contain.
  const end = `END_${createHash('sha256').update(value).digest('hex')}`;
  appendFileSync(file, `${name}<<${end}\n${value}\n${end}\n`);
};

const github = (path: string): unknown => JSON.parse(run('gh', ['api', `repos/${REPO}/${path}`]));

function environment(): Environment | undefined {
  const found = list(record(github('environments?per_page=100'))['environments'])
    .map(record)
    .find((e) => e['name'] === 'npm');
  if (!found) return undefined;
  const custom = record(found['deployment_branch_policy'])['custom_branch_policies'] === true;
  if (!custom) return { custom, policies: [] };
  const policies = record(github('environments/npm/deployment-branch-policies?per_page=100'));
  return {
    custom,
    policies: list(policies['branch_policies'])
      .map(record)
      .map((p) => ({ name: text(p['name']), type: text(p['type']) })),
  };
}

function notes(version: string, tree: Tree): string {
  const changelogs = publicPackages(tree).map(({ dir, manifest }) => ({
    name: manifest.name,
    dir,
    text: tree.read(`${dir}/CHANGELOG.md`) ?? '',
  }));
  const written = tree.read(`.github/releases/${version}.md`);
  return releaseNotes(version, changelogs, `https://github.com/${REPO}`, written);
}

async function check(stage: boolean): Promise<void> {
  const packages = publicPackages(workingTree);
  const version = sharedVersion(packages);
  const names = packages.map((p) => p.manifest.name);
  const broken = [...orderProblems(names), ...repositoryProblems(packages.map((p) => p.manifest))];
  if (broken.length > 0) throw new Error(broken.join('\n'));
  const tag = distTag(version);
  if (!tag) throw new Error(`version ${version} is neither x.y.z nor x.y.z-next.N`);

  const registry = new Map<string, Registry>(
    await Promise.all(
      names.map(async (name): Promise<[string, Registry]> => [
        name,
        registryOf(await npm.packument(name), name),
      ]),
    ),
  );
  const problems = stageProblems({
    ref: env['GITHUB_REF'] ?? '',
    version,
    pre: workingTree.read('.changeset/pre.json'),
    environment: environment(),
    registry,
  });
  if (stage && problems.length > 0) {
    throw new Error(`can't stage ${version}:\n${problems.join('\n')}`);
  }
  const body = notes(version, workingTree);

  output('version', version);
  output('tag', tag);
  output('node', (workingTree.read('.nvmrc') ?? '').trim());
  // For the stage job, which has no checkout: a package a line, in approval
  // order, as "<group> <name> <file> <the dist-tag's version now, or ->".
  const lines = APPROVAL_ORDER.flatMap((group, at) =>
    group.map((name) => {
      const now = registry.get(name)?.tags[tag] ?? '-';
      return `${at + 1} ${name} ${tarballName(name, version)} ${now}`;
    }),
  );
  output('packages', lines.join('\n'));

  const verdict =
    problems.length === 0
      ? 'A stage of this commit passes its checks.'
      : `A stage of this commit would be refused:\n\n${problems.map((p) => `- ${p}`).join('\n')}`;
  const release = isStable(version) ? 'and gets a GitHub Release' : 'and gets no GitHub Release';
  summary(
    `## ${version}\n\n${verdict}\n\nIt would be staged as \`${tag}\`, ${release}. The notes:\n\n${body}`,
  );
}

function pack(into: string): void {
  const packages = publicPackages(workingTree);
  const version = sharedVersion(packages);
  mkdirSync(into, { recursive: true });
  const sums: string[] = [];
  const rows: string[] = [];
  for (const [at, group] of APPROVAL_ORDER.entries()) {
    for (const name of group) {
      const dir = packages.find((p) => p.manifest.name === name)?.dir;
      if (!dir) throw new Error(`no package ${name}`);
      // pnpm, so `workspace:*` and `catalog:` become versions and publishConfig applies.
      run('pnpm', ['pack', '--pack-destination', resolve(into)], dir);
      const file = tarballName(name, version);
      const bytes = readFileSync(join(into, file));
      const sha1 = createHash('sha1').update(bytes).digest('hex');
      sums.push(`${file} ${sha1} ${createHash('sha512').update(bytes).digest('hex')}`);
      const link = `[\`${name}\`](https://www.npmjs.com/package/${name})`;
      rows.push(`| ${at + 1} | ${link} | \`${sha1}\` |`);
    }
  }
  output('sums', sums.join('\n'));
  summary(
    [
      `## ${version}: the tarballs, in approval order`,
      '',
      "Approve nothing from this table. A stage run's stage job writes the checklist once everything is staged.",
      '',
      '| Group | Package | Shasum |',
      '| --- | --- | --- |',
      ...rows,
    ].join('\n'),
  );
}

async function finish(id: string): Promise<void> {
  const from: Sources = {
    github,
    stagedRecord: (runId, artifact) => {
      const dir = mkdtempSync(join(tmpdir(), 'isoloop-staged-'));
      run('gh', ['run', 'download', runId, '--repo', REPO, '--name', artifact, '--dir', dir]);
      return readFileSync(join(dir, 'staged.json'), 'utf8');
    },
    tree: treeAt,
    workflowsChanged: (commit) =>
      run('git', ['diff', '--name-only', commit, 'HEAD', '--', '.github/workflows']) !== '',
    npm,
  };
  const { commit, tag, version } = await checkFinish(env['GITHUB_REF'] ?? '', id, from);
  const stable = isStable(version);
  output('commit', commit);
  output('tag', tag);
  output('stable', String(stable));
  // Read at the staged commit, so the text has to merge before the stage.
  output('notes', stable ? notes(version, treeAt(commit)) : '');
  summary(
    `Run ${id} is on npm as ${version}, with its shasums and provenance: ${tag} on ${commit}.`,
  );
}

const [command, argument = ''] = process.argv.slice(2);
if (command === 'check' && (argument === '' || argument === '--stage')) {
  await check(argument === '--stage');
} else if (command === 'pack' && argument) {
  pack(argument);
} else if (command === 'finish') {
  await finish(argument);
} else {
  throw new Error('usage: release.ts check [--stage] | pack <dir> | finish <run id>');
}
