import { describe, expect, it } from 'vitest';
import {
  type Candidate,
  distTag,
  isPlain,
  releaseBranch,
  releaseProblems,
  repositoryProblems,
} from './rules.ts';

const ok: Candidate = { tag: 'v0.1.0', version: '0.1.0', preMode: false, branches: ['main'] };

describe('releaseProblems', () => {
  it('passes a plain version, its tag, on main, out of pre mode', () => {
    expect(releaseProblems(ok)).toEqual([]);
  });

  it("passes a patch on its line's release branch", () => {
    const patch = { tag: 'v0.1.1', version: '0.1.1', branches: ['release/0.1'] };
    expect(releaseProblems({ ...ok, ...patch })).toEqual([]);
  });

  it("refuses another line's release branch, and any other branch", () => {
    expect(releaseProblems({ ...ok, branches: ['release/0.2'] })).toHaveLength(1);
    expect(releaseProblems({ ...ok, branches: ['feature/x'] })).toHaveLength(1);
    expect(releaseProblems({ ...ok, branches: [''] })).toHaveLength(1);
  });

  it('refuses a tag that is not the version', () => {
    expect(releaseProblems({ ...ok, tag: 'v0.1.1' })).toHaveLength(1);
    expect(releaseProblems({ ...ok, tag: '0.1.0' })).toHaveLength(1);
  });

  it('refuses a prerelease, even with its own tag', () => {
    const next = { tag: 'v0.1.0-next.11', version: '0.1.0-next.11' };
    expect(releaseProblems({ ...ok, ...next })[0]).toContain("isn't a release");
  });

  it('refuses pre mode', () => {
    expect(releaseProblems({ ...ok, preMode: true })[0]).toContain('pre exit');
  });
});

describe('isPlain', () => {
  it('takes x.y.z only', () => {
    expect(isPlain('0.1.0')).toBe(true);
    for (const v of ['0.1.0-next.1', '0.1', 'v0.1.0', '0.1.0+build']) {
      expect(isPlain(v)).toBe(false);
    }
  });
});

describe('releaseBranch', () => {
  it('names the minor line', () => {
    expect(releaseBranch('0.10.3')).toBe('release/0.10');
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

describe('distTag', () => {
  it('moves latest forward, from the 0.0.0 placeholder too', () => {
    expect(distTag('0.1.0', '0.0.0')).toBe('latest');
    expect(distTag('0.1.1', '0.1.0')).toBe('latest');
    expect(distTag('0.10.0', '0.9.4')).toBe('latest');
    expect(distTag('1.0.0', '0.12.1')).toBe('latest');
    expect(distTag('0.1.0', undefined)).toBe('latest');
  });

  it('keeps latest on a re-run of the same version', () => {
    expect(distTag('0.1.0', '0.1.0')).toBe('latest');
  });

  it('never moves latest back', () => {
    expect(distTag('0.1.2', '0.2.0')).toBe('release-0.1');
    expect(distTag('0.2.0', '0.2.1')).toBe('release-0.2');
    expect(distTag('0.9.5', '0.10.0')).toBe('release-0.9');
  });
});
