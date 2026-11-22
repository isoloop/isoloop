import { describe, expect, it } from 'vitest';
import { record } from './npm.ts';
import { publicPackages, workingTree } from './packages.ts';
import {
  APPROVAL_ORDER,
  type Candidate,
  compare,
  distTag,
  isStable,
  orderProblems,
  type Registry,
  repositoryProblems,
  stageProblems,
} from './rules.ts';

const pre = JSON.stringify({ mode: 'pre', tag: 'next' });
const registry = (tags: Record<string, string>, versions: string[] = []): Map<string, Registry> =>
  new Map([['@isoloop/host', { tags, versions }]]);

const preview: Candidate = {
  ref: 'refs/heads/main',
  version: '0.1.0-next.12',
  pre,
  environment: { custom: true, policies: [{ name: 'main', type: 'branch' }] },
  registry: registry({ latest: '0.0.0', next: '0.1.0-next.11' }),
};
const release: Candidate = { ...preview, version: '0.1.0', pre: undefined };

const groupOf = (name: string): number => APPROVAL_ORDER.findIndex((g) => g.includes(name));

describe('stageProblems', () => {
  it('passes a preview in pre mode and a release out of it', () => {
    expect(stageProblems(preview)).toEqual([]);
    expect(stageProblems(release)).toEqual([]);
  });

  it('refuses any ref but main', () => {
    for (const ref of ['refs/heads/release/0.1', 'refs/heads/main2', 'refs/tags/v0.1.0', '']) {
      expect(stageProblems({ ...preview, ref })[0]).toContain('main only');
    }
  });

  it('refuses a preview outside pre mode `next`', () => {
    const outside = [
      undefined,
      JSON.stringify({ mode: 'exit', tag: 'next' }),
      JSON.stringify({ mode: 'pre', tag: 'beta' }),
    ];
    for (const mode of outside) {
      expect(stageProblems({ ...preview, pre: mode })[0]).toContain('pre mode');
    }
  });

  it('refuses a release while pre.json exists, exited or not', () => {
    for (const mode of [pre, JSON.stringify({ mode: 'exit', tag: 'next' })]) {
      expect(stageProblems({ ...release, pre: mode })[0]).toContain('pre exit');
    }
  });

  it('refuses a version already on npm', () => {
    const on = registry({ latest: '0.0.0', next: '0.1.0-next.12' }, ['0.1.0-next.12']);
    expect(stageProblems({ ...preview, registry: on })[0]).toContain('already on npm');
  });

  it("refuses an older line than npm's latest", () => {
    const newer = registry({ latest: '0.2.0' });
    expect(stageProblems({ ...release, version: '0.1.1', registry: newer })[0]).toContain('older');
    // A preview of a version that's out already is older than it.
    const out = registry({ latest: '0.1.0', next: '0.1.0-next.11' });
    expect(stageProblems({ ...preview, registry: out })[0]).toContain('older');
  });

  it('refuses a preview behind the `next` dist-tag', () => {
    const ahead = registry({ latest: '0.0.0', next: '0.1.0-next.13' });
    expect(stageProblems({ ...preview, registry: ahead })[0]).toContain('older');
  });

  it('refuses a version of neither kind', () => {
    expect(stageProblems({ ...release, version: '0.1.0-beta.1' })[0]).toContain('neither');
  });

  it('refuses without the environment, or with a wider policy', () => {
    const main = { name: 'main', type: 'branch' };
    const bad: Candidate['environment'][] = [
      undefined,
      { custom: false, policies: [] },
      { custom: true, policies: [] },
      { custom: true, policies: [{ name: 'release/*', type: 'branch' }] },
      { custom: true, policies: [{ name: 'main', type: 'tag' }] },
      { custom: true, policies: [main, { name: 'release/0.1', type: 'branch' }] },
    ];
    for (const environment of bad) {
      expect(stageProblems({ ...preview, environment })[0]).toContain('`npm`');
    }
  });
});

describe('versions', () => {
  it('gives next to a preview and latest to a release, and nothing else a tag', () => {
    expect(distTag('0.1.0-next.12')).toBe('next');
    expect(distTag('0.1.0')).toBe('latest');
    for (const version of ['0.1.0-beta.1', 'v0.1.0', '0.1', '0.1.0+build', '0.0.0-stage']) {
      expect(distTag(version)).toBeUndefined();
    }
    expect(isStable('0.1.0')).toBe(true);
    expect(isStable('0.1.0-next.1')).toBe(false);
  });

  it('sorts a release after its previews, and numbers as numbers', () => {
    expect(compare('0.1.0', '0.1.0-next.11')).toBe(1);
    expect(compare('0.1.0-next.12', '0.1.0-next.2')).toBe(1);
    expect(compare('0.2.0-next.0', '0.1.9')).toBe(1);
    expect(compare('0.9.4', '0.10.0')).toBe(-1);
    expect(compare('0.1.0', '0.1.0')).toBe(0);
  });
});

describe('the approval order', () => {
  const packages = publicPackages(workingTree);

  it('has every public package once, and no other', () => {
    expect(orderProblems(packages.map((p) => p.manifest.name))).toEqual([]);
    expect(new Set(APPROVAL_ORDER.flat()).size).toBe(APPROVAL_ORDER.flat().length);
    expect(orderProblems(['@isoloop/new'])).not.toEqual([]);
  });

  it('puts what a package depends on in an earlier group', () => {
    for (const { dir, manifest } of packages) {
      const parsed = record(JSON.parse(workingTree.read(`${dir}/package.json`) ?? '{}'));
      const deps = { ...record(parsed['dependencies']), ...record(parsed['peerDependencies']) };
      for (const dep of Object.keys(deps).filter((name) => groupOf(name) !== -1)) {
        expect(groupOf(dep), `${manifest.name} → ${dep}`).toBeLessThan(groupOf(manifest.name));
      }
    }
  });
});

describe('repositoryProblems', () => {
  it('names each package with another repository url', () => {
    const url = 'git+https://github.com/isoloop/isoloop.git';
    const packages = [
      { name: 'good', repository: { url } },
      { name: 'other', repository: { url: 'git+https://github.com/isoloop/web.git' } },
      { name: 'none' },
    ];
    const problems = repositoryProblems(packages);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('other');
    expect(problems[1]).toContain('none');
  });
});
