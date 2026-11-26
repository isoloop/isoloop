import { describe, expect, it } from 'vitest';
import {
  belowOne,
  bumps,
  type Change,
  decide,
  isBreaking,
  isVersionPr,
  migrationTarget,
  summaryOf,
  parseNameStatus,
  type ReadPair,
} from './changeset-check.ts';

const changeset = (bump: string, name = '@isoloop/bus'): string =>
  `---\n'${name}': ${bump}\n---\n\nSomething changed.\n`;

const manifest = (version: string, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ name: '@isoloop/bus', version, type: 'module', ...extra }, null, 2)}\n`;

/** A repo as two maps of path to text: the merge base and the PR. */
function repo(base: Record<string, string>, head: Record<string, string>): ReadPair {
  return (path) => ({ base: base[path], head: head[path] });
}

const version = '0.1.0-next.0';

describe('the major guard', () => {
  const changes: Change[] = [
    { status: 'A', path: '.changeset/big-change.md' },
    { status: 'M', path: 'packages/bus/src/index.ts' },
  ];
  const read = repo({}, { '.changeset/big-change.md': changeset('major') });

  it('fails a major on 0.x without the release-1.0 label', () => {
    const result = decide({ version, labels: [], changes, read });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('@isoloop/bus in .changeset/big-change.md');
    expect(result.error).toContain('below 1.0.0');
    expect(result.error).toContain('On 0.x a breaking change is a minor');
    expect(result.error).toContain('`release-1.0`');
  });

  it('fails it even with the no-changeset label', () => {
    expect(decide({ version, labels: ['no-changeset'], changes, read }).ok).toBe(false);
  });

  it('passes a major with the release-1.0 label, and runs the normal check', () => {
    expect(decide({ version, labels: ['release-1.0'], changes, read })).toMatchObject({
      ok: true,
      run: true,
    });
  });

  it('passes a minor, and runs the normal check', () => {
    const minor = repo({}, { '.changeset/big-change.md': changeset('minor') });
    expect(decide({ version, labels: [], changes, read: minor })).toMatchObject({
      ok: true,
      run: true,
    });
  });

  it('passes a major from 1.0.0 on', () => {
    expect(decide({ version: '1.0.0', labels: [], changes, read }).ok).toBe(true);
  });

  it('ignores a major changeset the PR deletes (a version PR consuming it)', () => {
    const deleted: Change[] = [{ status: 'D', path: '.changeset/big-change.md' }];
    const consumed = repo({ '.changeset/big-change.md': changeset('major') }, {});
    expect(decide({ version, labels: [], changes: deleted, read: consumed })).toMatchObject({
      ok: true,
      run: false,
    });
  });
});

describe('the codemod gate', () => {
  const breaking = `---\n'@isoloop/runtime': minor\n---\n\nbreaking: publish takes the value.\n`;
  const at = '0.1.0';
  const base: Change[] = [
    { status: 'A', path: '.changeset/publish-shape.md' },
    { status: 'M', path: 'packages/runtime/src/bus/bus-client.ts' },
  ];
  const read = repo({}, { '.changeset/publish-shape.md': breaking });

  it('fails a breaking: changeset without fixtures for the release it ships in', () => {
    const result = decide({ version: at, labels: [], changes: base, read });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('.changeset/publish-shape.md is a `breaking:` changeset');
    expect(result.error).toContain('packages/cli/src/migrate/0.2/fixtures/');
  });

  it('fails it even with the no-changeset label', () => {
    expect(decide({ version: at, labels: ['no-changeset'], changes: base, read }).ok).toBe(false);
  });

  it('passes with a before fixture added or changed under that release', () => {
    for (const status of ['A', 'M']) {
      const changes = [
        ...base,
        { status, path: 'packages/cli/src/migrate/0.2/fixtures/publish.before.ts' },
        { status, path: 'packages/cli/src/migrate/0.2/fixtures/publish.after.ts' },
      ];
      expect(decide({ version: at, labels: [], changes, read })).toMatchObject({
        ok: true,
        run: true,
      });
    }
  });

  it('fails with fixtures for another release, deleted ones, or after files alone', () => {
    for (const extra of [
      { status: 'A', path: 'packages/cli/src/migrate/0.3/fixtures/publish.before.ts' },
      { status: 'D', path: 'packages/cli/src/migrate/0.2/fixtures/publish.before.ts' },
      { status: 'A', path: 'packages/cli/src/migrate/0.2/fixtures/publish.after.ts' },
      { status: 'A', path: 'packages/cli/src/migrate/0.2/step.ts' },
    ]) {
      expect(decide({ version: at, labels: [], changes: [...base, extra], read }).ok).toBe(false);
    }
  });

  it('ignores a breaking changeset the PR deletes, and other summaries', () => {
    const deleted: Change[] = [{ status: 'D', path: '.changeset/publish-shape.md' }];
    expect(decide({ version: at, labels: [], changes: deleted, read }).ok).toBe(true);
    const plain = repo({}, { '.changeset/publish-shape.md': changeset('minor') });
    expect(decide({ version: at, labels: [], changes: base, read: plain }).ok).toBe(true);
  });

  it('reads the summary after the front matter', () => {
    expect(summaryOf(breaking)).toBe('breaking: publish takes the value.');
    expect(isBreaking(breaking)).toBe(true);
    expect(isBreaking(changeset('minor'))).toBe(false);
    expect(isBreaking(`---\n'a': minor\n---\n\nNot breaking: a note.\n`)).toBe(false);
    expect(isBreaking(`---\r\n'a': minor\r\n---\r\n\r\nbreaking: crlf\r\n`)).toBe(true);
  });

  it('names the release a change ships in', () => {
    expect(migrationTarget('0.1.0', [])).toBe('0.2');
    expect(migrationTarget('0.1.1', [])).toBe('0.2');
    expect(migrationTarget('0.2.0-next.3', [])).toBe('0.2');
    expect(migrationTarget('0.2.1-next.0', [])).toBe('0.3');
    expect(migrationTarget('0.9.2', ['release-1.0'])).toBe('1.0');
    expect(migrationTarget('1.0.0-next.1', ['release-1.0'])).toBe('1.0');
    expect(migrationTarget('1.0.0', [])).toBe('2.0');
    expect(migrationTarget('2.0.0-next.0', [])).toBe('2.0');
  });
});

describe('version PRs', () => {
  // The shape of #227: changesets moved under pre/, versions and changelogs written.
  const changes: Change[] = [
    { status: 'D', path: '.changeset/group-commit-seq.md' },
    { status: 'A', path: '.changeset/pre/group-commit-seq.md' },
    { status: 'M', path: '.changeset/pre.json' },
    { status: 'M', path: 'packages/bus/CHANGELOG.md' },
    { status: 'M', path: 'packages/bus/package.json' },
    { status: 'A', path: 'packages/codec/CHANGELOG.md' },
  ];
  const base = {
    '.changeset/group-commit-seq.md': changeset('patch'),
    'packages/bus/package.json': manifest('0.1.0-next.0'),
  };
  const head = {
    '.changeset/pre/group-commit-seq.md': changeset('patch'),
    'packages/bus/package.json': manifest('0.1.0-next.1'),
  };

  it('passes a pure version PR without the no-changeset label', () => {
    expect(decide({ version, labels: [], changes, read: repo(base, head) })).toMatchObject({
      ok: true,
      run: false,
    });
  });

  it('runs the normal check when the version PR also changes another file', () => {
    const more = [...changes, { status: 'M', path: 'packages/bus/src/index.ts' }];
    expect(isVersionPr(more, repo(base, head))).toBe(false);
    expect(decide({ version, labels: [], changes: more, read: repo(base, head) })).toMatchObject({
      ok: true,
      run: true,
    });
  });

  it('runs the normal check when a manifest changes more than its version', () => {
    const deps = { ...head, 'packages/bus/package.json': manifest('0.1.0-next.1', { x: 1 }) };
    expect(isVersionPr(changes, repo(base, deps))).toBe(false);
  });

  it("isn't one when it edits a pending changeset", () => {
    const edit: Change[] = [{ status: 'M', path: '.changeset/group-commit-seq.md' }];
    expect(isVersionPr(edit, repo(base, base))).toBe(false);
  });

  it("isn't one when the diff is empty", () => {
    expect(isVersionPr([], repo({}, {}))).toBe(false);
  });

  it('skips on the no-changeset label', () => {
    const other: Change[] = [{ status: 'M', path: '.github/workflows/ci.yml' }];
    expect(
      decide({ version, labels: ['no-changeset'], changes: other, read: repo({}, {}) }),
    ).toMatchObject({ ok: true, run: false });
  });
});

describe('parsing', () => {
  it('reads every quoting of a changeset bump', () => {
    const text = `---\n'@isoloop/a': major\n"@isoloop/b": minor\n@isoloop/c: patch\n---\n\nbody: major\n`;
    expect([...bumps(text)]).toEqual([
      ['@isoloop/a', 'major'],
      ['@isoloop/b', 'minor'],
      ['@isoloop/c', 'patch'],
    ]);
  });

  it('orders versions around 1.0.0 as semver does', () => {
    expect(belowOne('0.1.0-next.0')).toBe(true);
    expect(belowOne('0.9.3')).toBe(true);
    expect(belowOne('1.0.0-next.2')).toBe(true);
    expect(belowOne('1.0.0')).toBe(false);
    expect(belowOne('2.3.0-next.0')).toBe(false);
  });

  it('reads git name-status output', () => {
    expect(parseNameStatus('A\t.changeset/x.md\nM\tpackages/bus/package.json\n')).toEqual([
      { status: 'A', path: '.changeset/x.md' },
      { status: 'M', path: 'packages/bus/package.json' },
    ]);
  });
});
