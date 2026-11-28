import { describe, expect, it } from 'vitest';
import { decide, idsIn } from './pr.ts';

const sup = (ids: string[]) => JSON.stringify(ids.map((id) => ({ id })));
const WITH_LINES = `# ADR\n\nRules: \`sup.restart-limit\`\n`;

function runPr(opts: {
  labels?: string[];
  changed: string[];
  files: Record<string, { base?: string; head?: string }>;
}) {
  const files = opts.files;
  const ruleFiles = Object.keys(files).filter(
    (p) => (p.startsWith('.archeion/rules/') || p.startsWith('docs/rules/')) && p.endsWith('.json'),
  );
  return decide({
    labels: opts.labels ?? [],
    changed: opts.changed,
    baseRuleFiles: ruleFiles.filter((p) => files[p]!.base !== undefined),
    headRuleFiles: ruleFiles.filter((p) => files[p]!.head !== undefined),
    read: (p) => ({ base: files[p]?.base, head: files[p]?.head }),
  });
}

describe('the Rules workflow', () => {
  const rulesFile = { base: sup(['sup.restart-limit']), head: sup(['sup.restart-limit']) };

  it('fails an ADR change with Rules: lines and no rules change', () => {
    const d = runPr({
      changed: ['docs/adr/0007-bus.md'],
      files: {
        'docs/adr/0007-bus.md': { base: WITH_LINES, head: `${WITH_LINES}more\n` },
        '.archeion/rules/supervision.json': rulesFile,
      },
    });
    expect(d.ok).toBe(false);
    expect(!d.ok && d.errors[0]).toContain(
      "docs/adr/0007-bus.md changed, but .archeion/rules/ didn't",
    );
  });

  it('passes it with a rules change, or the no-rules label', () => {
    const files = {
      'docs/adr/0007-bus.md': { base: WITH_LINES, head: `${WITH_LINES}more\n` },
      '.archeion/rules/supervision.json': rulesFile,
    };
    expect(
      runPr({ changed: ['docs/adr/0007-bus.md', '.archeion/rules/supervision.json'], files }).ok,
    ).toBe(true);
    expect(runPr({ changed: ['docs/adr/0007-bus.md'], files, labels: ['no-rules'] }).ok).toBe(true);
  });

  it('skips ADRs with no Rules: lines until the backfill reaches them, and the index', () => {
    const d = runPr({
      changed: ['docs/adr/0001-one.md', 'docs/adr/README.md'],
      files: {
        'docs/adr/0001-one.md': { base: '# ADR\n', head: '# ADR\nmore\n' },
        '.archeion/rules/supervision.json': rulesFile,
      },
    });
    expect(d.ok).toBe(true);
  });

  it('holds an ADR from 0026 on to the pairing and to its Rules: lines, from the start', () => {
    const md = '## Decision\n\n1. **One.**\n\n2. **Two.**\n\n   Rules: `sup.a`\n';
    const noLines = runPr({
      changed: ['docs/adr/0031-new.md'],
      files: { 'docs/adr/0031-new.md': { head: '## Decision\n\nText.\n' } },
    });
    expect(noLines.ok).toBe(false);
    expect(!noLines.ok && noLines.errors[0]).toContain(".archeion/rules/ didn't");
    const missing = runPr({
      changed: ['docs/adr/0031-new.md', '.archeion/rules/supervision.json'],
      files: {
        'docs/adr/0031-new.md': { head: md },
        '.archeion/rules/supervision.json': { base: '[]', head: JSON.stringify([{ id: 'sup.a' }]) },
      },
    });
    expect(missing).toEqual({
      ok: false,
      errors: ['docs/adr/0031-new.md: decision 1 has no Rules: line.'],
    });
  });

  it('counts a new ADR with Rules: lines', () => {
    const d = runPr({
      changed: ['docs/adr/0030-new.md'],
      files: { 'docs/adr/0030-new.md': { head: WITH_LINES } },
    });
    expect(d.ok).toBe(false);
  });

  it('fails when an id disappears, even with the label; a kept alias is fine', () => {
    const gone = runPr({
      labels: ['no-rules'],
      changed: ['.archeion/rules/supervision.json'],
      files: {
        '.archeion/rules/supervision.json': { base: sup(['sup.a', 'sup.b']), head: sup(['sup.a']) },
      },
    });
    expect(gone.ok).toBe(false);
    expect(!gone.ok && gone.errors[0]).toContain('Rule ids removed: sup.b');
    const renamed = runPr({
      changed: ['.archeion/rules/supervision.json'],
      files: {
        '.archeion/rules/supervision.json': {
          base: sup(['sup.a', 'sup.b']),
          head: JSON.stringify([{ id: 'sup.a' }, { id: 'sup.c', aliases: ['sup.b'] }]),
        },
      },
    });
    expect(renamed.ok).toBe(true);
    const moved = runPr({
      changed: ['.archeion/rules/supervision.json', '.archeion/rules/durability.json'],
      files: {
        '.archeion/rules/supervision.json': { base: sup(['sup.a']), head: sup([]) },
        '.archeion/rules/durability.json': {
          base: '[]',
          head: JSON.stringify([{ id: 'dur.a', aliases: ['sup.a'] }]),
        },
      },
    });
    expect(moved.ok).toBe(true);
  });

  it('reads ids and aliases, and nothing from broken JSON', () => {
    expect(idsIn(JSON.stringify([{ id: 'a.b', aliases: ['a.c'] }, 3, null]))).toEqual([
      'a.b',
      'a.c',
    ]);
    expect(idsIn('{')).toEqual([]);
    expect(idsIn(undefined)).toEqual([]);
  });

  it('lets ids disappear only with the rules-moved label', () => {
    const files = {
      '.archeion/rules/supervision.json': {
        base: sup(['sup.a', 'sup.b']),
        head: sup(['sup.a']),
      },
    };
    const changed = ['.archeion/rules/supervision.json'];
    const blocked = runPr({ changed, files });
    expect(!blocked.ok && blocked.errors[0]).toContain('Rule ids removed: sup.b');
    expect(runPr({ changed, files, labels: ['no-rules'] }).ok).toBe(false);
    expect(runPr({ changed, files, labels: ['rules-moved'] }).ok).toBe(true);
  });

  it('reads a base from before the move in docs/rules/', () => {
    const d = runPr({
      changed: ['docs/rules/toolchain.json', '.archeion/rules/toolchain.json'],
      files: {
        'docs/rules/toolchain.json': { base: sup(['tool.a', 'tool.b']) },
        '.archeion/rules/toolchain.json': { head: sup(['tool.a']) },
      },
    });
    expect(!d.ok && d.errors[0]).toContain('Rule ids removed: tool.b');
  });
});
