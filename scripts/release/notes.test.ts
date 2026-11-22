import { describe, expect, it } from 'vitest';
import { entries, MAX_BODY, quoteMentions, releaseNotes, section } from './notes.ts';

const repo = 'https://github.com/isoloop/isoloop';

// As Changesets writes them: a shared entry in both, dependency lines, an older section.
const host = `# @isoloop/host

## 0.1.0

### Minor Changes

- 0e0ca1c: The kernel.

  A second paragraph.
  - a nested point
- f37983d: A shared change.

### Patch Changes

- 1234567: A fix.
- Updated dependencies [0e0ca1c]
- Updated dependencies [f37983d]
  - @isoloop/protocol@0.1.0

## 0.1.0-next.1

### Patch Changes

- 7654321: An older entry.
`;

const bus = `# @isoloop/bus

## 0.1.0

### Patch Changes

- f37983d: A shared change.
- @isoloop/protocol@0.1.0
`;

const logs = [
  { name: '@isoloop/host', dir: 'packages/host', text: host },
  { name: '@isoloop/bus', dir: 'packages/bus', text: bus },
];

describe('section', () => {
  it('takes one version, not the ones that start with it', () => {
    expect(section(host, '0.1.0')?.join('\n')).not.toContain('An older entry.');
    expect(section(host, '0.1.0-next.1')?.join('\n')).toContain('An older entry.');
    expect(section(host, '0.1')).toBeUndefined();
  });
});

describe('entries', () => {
  it('drops the hash and the dependency bumps, keeps paragraphs and lists', () => {
    expect(entries(section(host, '0.1.0') ?? [])).toEqual([
      { bump: 'Minor', text: 'The kernel.\n\nA second paragraph.\n- a nested point' },
      { bump: 'Minor', text: 'A shared change.' },
      { bump: 'Patch', text: 'A fix.' },
    ]);
    expect(entries(section(bus, '0.1.0') ?? [])).toEqual([
      { bump: 'Patch', text: 'A shared change.' },
    ]);
  });

  it('keeps an entry that starts with a package name', () => {
    const lines = ['### Minor Changes', '', '- @isoloop/webmcp is new.'];
    expect(entries(lines)).toEqual([{ bump: 'Minor', text: '@isoloop/webmcp is new.' }]);
  });
});

describe('quoteMentions', () => {
  it('quotes a mention outside code only', () => {
    expect(quoteMentions('Marks @internal and `@experimental`.')).toBe(
      'Marks `@internal` and `@experimental`.',
    );
    expect(quoteMentions('someone@example.com')).toBe('someone@example.com');
  });
});

describe('releaseNotes', () => {
  it('lists a shared entry once, under its highest bump, with its packages', () => {
    const notes = releaseNotes('0.1.0', logs, repo);
    expect(notes.match(/A shared change\./g)).toHaveLength(1);
    expect(notes).toContain('- **host, bus:** A shared change.');
    expect(notes.indexOf('A shared change.')).toBeLessThan(notes.indexOf('## Patch changes'));
    expect(notes).toContain('- **host:** The kernel.\n\n  A second paragraph.');
    expect(notes).toContain(`${repo}/blob/v0.1.0/packages/bus/CHANGELOG.md`);
  });

  it('fails when no changelog has the version', () => {
    expect(() => releaseNotes('0.2.0', logs, repo)).toThrow('0.2.0');
  });

  it('says so when a version only bumps dependencies', () => {
    const text = '## 0.1.1\n\n### Patch Changes\n\n- @isoloop/protocol@0.1.1\n';
    const notes = releaseNotes(
      '0.1.1',
      [{ name: '@isoloop/dom', dir: 'packages/dom', text }],
      repo,
    );
    expect(notes).toContain('No changes besides the version.');
  });

  it('uses the hand-written text when there is one, with the changelog links', () => {
    const notes = releaseNotes('0.1.0', logs, repo, 'The first release, marked @experimental.\n');
    expect(notes).toContain('The first release, marked `@experimental`.');
    expect(notes).toContain(`${repo}/blob/v0.1.0/packages/host/CHANGELOG.md`);
    expect(notes).not.toContain('A shared change.');
  });

  it("links the changelogs instead when it's too long for GitHub", () => {
    const text = `## 0.1.0\n\n### Minor Changes\n\n- ${'x'.repeat(MAX_BODY)}\n`;
    const notes = releaseNotes('0.1.0', [{ name: 'isoloop', dir: 'packages/cli', text }], repo);
    expect(notes.length).toBeLessThan(1000);
    expect(notes).toContain('CHANGELOG.md');
  });
});
