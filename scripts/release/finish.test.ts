import { describe, expect, it } from 'vitest';
import { checkFinish, type Sources, type Staged, WORKFLOW } from './finish.ts';
import { tarballName, type Tree } from './packages.ts';

const RUN = '4500';
const COMMIT = 'a'.repeat(40);
const VERSION = '0.1.0-next.12';
const NAMES = ['@isoloop/protocol', '@isoloop/host', 'isoloop'];
const GITHUB = 'https://github.com/isoloop/isoloop';

const staged: Staged[] = NAMES.map((name, i) => ({
  name,
  file: tarballName(name, VERSION),
  sha1: String(i + 1).repeat(40),
  sha512: String(i + 1).repeat(128),
}));

/** What a test changes from a run that went well. */
interface World {
  ref?: string;
  id?: string;
  path?: string;
  branch?: string;
  conclusion?: string;
  stageJob?: string;
  artifacts?: string[];
  recordRun?: string;
  recordPackages?: Staged[];
  missing?: string;
  distTag?: string;
  shasum?: string;
  provenance?: boolean;
  provenanceRun?: string;
  provenancePath?: string;
  provenanceCommit?: string;
  attempt?: number;
  tagged?: boolean;
  workflowsChanged?: boolean;
}

function finish(world: World = {}): ReturnType<typeof checkFinish> {
  const tree: Tree = {
    packageDirs: () => NAMES.map((_, i) => `packages/p${i}`),
    read: (path) => {
      const i = /^packages\/p(\d+)\/package\.json$/.exec(path)?.[1];
      return i && JSON.stringify({ name: NAMES[Number(i)], version: VERSION });
    },
  };
  const sources: Sources = {
    github: (path) => {
      if (path === `actions/runs/${RUN}`) {
        return {
          path: world.path ?? WORKFLOW,
          event: 'workflow_dispatch',
          head_branch: world.branch ?? 'main',
          head_sha: COMMIT,
          head_repository: { full_name: 'isoloop/isoloop' },
          status: 'completed',
          conclusion: world.conclusion ?? 'success',
        };
      }
      if (path.includes('/jobs?')) {
        return { jobs: [{ name: 'stage', conclusion: world.stageJob ?? 'success' }] };
      }
      if (path.includes('/artifacts?')) {
        const names = world.artifacts ?? ['tarballs-1', 'staged-1'];
        return { artifacts: names.map((name) => ({ name, expired: false })) };
      }
      if (path.startsWith('git/matching-refs/')) {
        return world.tagged ? [{ ref: `refs/tags/v${VERSION}` }] : [];
      }
      throw new Error(`unexpected GitHub call ${path}`);
    },
    stagedRecord: () =>
      JSON.stringify({
        run: world.recordRun ?? RUN,
        commit: COMMIT,
        version: VERSION,
        tag: 'next',
        packages: world.recordPackages ?? staged,
      }),
    tree: () => tree,
    workflowsChanged: () => world.workflowsChanged ?? false,
    npm: {
      packument: async (name) => {
        const pkg = staged.find((p) => p.name === name);
        if (!pkg || world.missing === name) return { 'dist-tags': {}, versions: {} };
        return {
          'dist-tags': { next: world.distTag ?? VERSION },
          versions: {
            [VERSION]: {
              dist: {
                shasum: world.shasum ?? pkg.sha1,
                integrity: `sha512-${Buffer.from(pkg.sha512, 'hex').toString('base64')}`,
              },
            },
          },
        };
      },
      attestations: async (name) => {
        if (world.provenance === false) return undefined;
        const statement = {
          subject: [{ digest: { sha512: staged.find((p) => p.name === name)?.sha512 } }],
          predicate: {
            buildDefinition: {
              externalParameters: {
                workflow: {
                  repository: GITHUB,
                  path: world.provenancePath ?? WORKFLOW,
                  ref: 'refs/heads/main',
                },
              },
              resolvedDependencies: [{ digest: { gitCommit: world.provenanceCommit ?? COMMIT } }],
            },
            runDetails: {
              metadata: {
                invocationId: `${GITHUB}/actions/runs/${world.provenanceRun ?? RUN}/attempts/${world.attempt ?? 1}`,
              },
            },
          },
        };
        const payload = Buffer.from(JSON.stringify(statement)).toString('base64');
        return {
          attestations: [
            {
              predicateType: 'https://slsa.dev/provenance/v1',
              bundle: { dsseEnvelope: { payload } },
            },
          ],
        };
      },
    },
  };
  return checkFinish(world.ref ?? 'refs/heads/main', world.id ?? RUN, sources);
}

describe('checkFinish', () => {
  it("passes a run whose packages are all on npm, and names that run's commit", async () => {
    await expect(finish()).resolves.toEqual({
      commit: COMMIT,
      tag: `v${VERSION}`,
      version: VERSION,
    });
  });

  it('passes a stage job that was re-run', async () => {
    const rerun = { attempt: 2, artifacts: ['tarballs-1', 'staged-2'] };
    await expect(finish(rerun)).resolves.toMatchObject({ commit: COMMIT });
  });

  it.each<[string, World, string]>([
    ['one package missing', { missing: '@isoloop/host' }, "@isoloop/host@0.1.0-next.12 isn't on"],
    ['a wrong shasum', { shasum: 'f'.repeat(40) }, "shasum isn't"],
    ['a wrong dist-tag', { distTag: '0.1.0-next.11' }, 'dist-tag next is 0.1.0-next.11'],
    ['no provenance', { provenance: false }, 'has no provenance'],
    ["another run's provenance", { provenanceRun: '4501' }, "run isn't 4500"],
    ['a run id that only starts alike', { provenanceRun: '45001' }, "run isn't 4500"],
    ['another workflow in the provenance', { provenancePath: 'x.yml' }, "workflow isn't"],
    ['another commit in the provenance', { provenanceCommit: 'b'.repeat(40) }, "commit isn't"],
    ["another workflow's run", { path: '.github/workflows/ci.yml' }, 'its workflow'],
    ['a run on another branch', { branch: 'ci/x' }, 'its branch'],
    ['a failed run', { conclusion: 'failure' }, 'its conclusion'],
    ['a dry run', { stageJob: 'skipped' }, 'staged nothing'],
    ['a run with no record', { artifacts: ['tarballs-1'] }, 'no staged-<attempt> artifact'],
    ['a record of another run', { recordRun: '4499' }, 'record is of run 4499'],
    ['a record short of a package', { recordPackages: staged.slice(1) }, 'different packages'],
    ['another ref', { ref: 'refs/heads/ci/x' }, 'main only'],
    ['an id that is not a number', { id: '1; echo x' }, "isn't a run id"],
    ['a workflow change since the stage', { workflowsChanged: true }, 'workflows changed'],
  ])('refuses %s', async (_, world, message) => {
    await expect(finish(world)).rejects.toThrow(message);
  });

  it('can be re-run once tagged, after a workflow change too', async () => {
    const again = { tagged: true, workflowsChanged: true };
    await expect(finish(again)).resolves.toMatchObject({ commit: COMMIT });
  });
});
