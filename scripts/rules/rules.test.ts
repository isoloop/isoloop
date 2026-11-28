import { describe, expect, it } from 'vitest';
import { boardData, readBoardSources, renderBoard, renderReadme } from './build.ts';
import { parseConfig, REPO_ROOT } from './config.ts';
import {
  buildModel,
  buildSources,
  codePaths,
  deriveLinks,
  healthChecks,
  historyOf,
  keywordEdges,
  keywordGraph,
  keywordNeighbours,
  keywordRules,
  layoutKeywords,
  pointsOf,
  sectionsOf,
  sourceFlows,
  sourceOf,
  symbolsOf,
} from './model.ts';
import { checkRules, type CheckInput } from './check.ts';
import { decide, idsIn } from './pr.ts';
import {
  type Adr,
  compareVersions,
  parseAdr,
  parseRef,
  readAnchors,
  readRegistry,
  readRulesLines,
  rulesOf,
  unruledSections,
  rulesIn,
  type Registry,
  type Rule,
  slug,
} from './registry.ts';
import { ship } from './ship.ts';

const ADR_7 = `# ADR 0007: Bus worker supervision

## Decision

### 1. Supervise the bus like an isolate

Rules: \`sup.restart-limit\`

### Amended: the restart limit is a default (2026-11-20)

\`\`\`md
## Not a heading
\`\`\`

## Consequences

## Consequences
`;

type Raw = Record<string, unknown>;

/** A fixture object as plain JSON, for edits the types wouldn't allow. */
const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function raw(v: unknown): Raw {
  if (!isRaw(v)) throw new Error('not an object');
  return v;
}

/** Adds an event to a rule's own list. */
function pushEvent(r: Raw, e: Raw): void {
  const list: unknown = r['events'];
  if (!Array.isArray(list)) throw new Error('no events');
  (list as unknown[]).push(e);
}

/** A rule's events as plain JSON. */
function evs(r: Raw): Raw[] {
  const list: unknown = r['events'];
  if (!Array.isArray(list)) throw new Error('no events');
  return (list as unknown[]).map(raw);
}

function pushConcept(reg: Registry, c: unknown): void {
  if (!Array.isArray(reg.concepts)) throw new Error('no concepts');
  (reg.concepts as unknown[]).push(c);
}

const concepts = [
  { id: 'supervision', prefix: 'sup', name: 'Supervision', description: 'Restarts.', order: 1 },
  { id: 'durability', prefix: 'dur', name: 'Durability', description: 'Storage.', order: 2 },
];

function rules(): { sup: Rule[]; dur: Rule[] } {
  return {
    sup: [
      {
        id: 'sup.restart-limit',
        statement: 'The bus worker restarts at most `maxRestarts` times in `withinMs`.',
        status: 'active',
        values: ['3 restarts', '60 000 ms'],
        knob: '`KernelConfig.supervisor`',
        code: ['packages/host/src/kernel.ts'],
        since: '0.1.0',
        related: ['sup.short-runs'],
        events: [
          {
            type: 'decided',
            date: '2026-11-03',
            ref: 'adr/0007#1-supervise-the-bus-like-an-isolate',
            why: 'Same as isolates.',
          },
          {
            type: 'clarified',
            date: '2026-11-20',
            ref: 'adr/0007#amended-the-restart-limit-is-a-default-2026-11-20',
            why: 'A default, not a fixed limit.',
            prev: 'Read as a fixed 3 in 60 s.',
          },
          { type: 'shipped', date: '2026-11-23', ref: 'v0.1.0', why: 'First released in 0.1.0.' },
        ],
      },
      {
        id: 'sup.short-runs',
        statement: 'A crash after a short healthy run counts.',
        status: 'decided',
        target: '0.2.0',
        events: [
          {
            type: 'decided',
            date: '2026-11-24',
            ref: 'adr/0007#decision',
            why: 'Slow loops never failed.',
          },
          { type: 'built', date: '2026-11-24', ref: '#430', why: 'Merged on main.' },
        ],
      },
    ],
    dur: [
      {
        id: 'dur.no-replicas',
        statement: 'We don’t run replicated bus workers.',
        status: 'rejected',
        events: [
          {
            type: 'rejected',
            date: '2026-11-03',
            ref: 'adr/0007#consequences',
            why: 'Why not replicas? Same failure domain.',
          },
        ],
      },
    ],
  };
}

function registry(r = rules()): Registry {
  return {
    concepts: structuredClone(concepts),
    files: [
      { path: 'docs/rules/supervision.json', concept: 'supervision', data: r.sup },
      { path: 'docs/rules/durability.json', concept: 'durability', data: r.dur },
    ],
  };
}

const adrs = (): Map<string, Adr> =>
  new Map([['0007', parseAdr('0007-bus-worker-supervision.md', ADR_7)!]]);

/** The README a sound registry would have; malformed ones fail before the README is compared. */
function safeReadme(reg: Registry, a: Map<string, Adr>): string | undefined {
  try {
    return renderReadme(reg, a);
  } catch {
    return undefined;
  }
}

function input(reg: Registry, over: Partial<CheckInput> = {}): CheckInput {
  const a = over.adrs ?? adrs();
  return {
    reg,
    adrs: a,
    exists: () => true,
    readme: safeReadme(reg, a),
    version: '0.2.0-next.3',
    ...over,
  };
}

const messages = (inp: CheckInput): string[] =>
  checkRules(inp).map((p) => `${p.file}: ${p.message}`);

/** Mutates the first event of the first supervision rule and returns the check's messages. */
const ev = (change: (e: Raw) => void): string[] => withRule((r) => change(evs(r)[0]!));

/** The first supervision rule as an active repo rule, then `change`; the check's messages. */
const repo = (change: (r: Raw) => void): string[] =>
  withRule((r) => {
    r['repo'] = true;
    delete r['since'];
    const list: unknown = r['events'];
    if (Array.isArray(list)) list.pop();
    pushEvent(r, { type: 'built', date: '2026-11-24', ref: '#483', why: 'Merged.' });
    change(r);
  });

/** Mutates the first supervision rule (or the one at `i`) and returns the check's messages. */
function withRule(change: (r: Raw) => void, i = 0): string[] {
  const r = rules();
  change(raw(r.sup[i]));
  return messages(input(registry(r)));
}

describe('registry helpers', () => {
  it('slugs headings the way GitHub does', () => {
    expect(slug('1. Supervise the bus like an isolate')).toBe(
      '1-supervise-the-bus-like-an-isolate',
    );
    expect(slug('Amended: the restart limit is a default (2026-11-20)')).toBe(
      'amended-the-restart-limit-is-a-default-2026-11-20',
    );
    expect(slug("The host's `kernel.watch` (amended)")).toBe('the-hosts-kernelwatch-amended');
    expect(slug('[A link](x.md) and **bold**')).toBe('a-link-and-bold');
  });

  it('reads anchors outside fences, numbering repeats', () => {
    const a = readAnchors(ADR_7);
    expect(a.has('not-a-heading')).toBe(false);
    expect(a.has('consequences')).toBe(true);
    expect(a.has('consequences-1')).toBe(true);
  });

  it('skips Rules: lines in code fences, and reads indented ones', () => {
    expect(readRulesLines('```md\nRules: `x.y`\n```\n   Rules: `a.b`\n')).toEqual(['a.b']);
  });

  it('finds numbered decisions with no Rules: line', () => {
    const md = [
      '# ADR 0030: X',
      '## Decision',
      '### One part',
      '1. **First.** Text.',
      '',
      '   Rules: `sup.a`',
      '2. **Second.** Text.',
      '   ```md',
      '   Rules: `sup.b`',
      '   ```',
      '3. **Third.**',
      '### Amended: a change (2026-12-01)',
      'Text.',
      '## Consequences',
      '1. Not a decision.',
    ].join('\n');
    expect(unruledSections(md)).toEqual([
      'amendment "Amended: a change (2026-12-01)"',
      'decision 2',
      'decision 3',
    ]);
  });

  it('counts numbered ### headings as decisions when an ADR uses them', () => {
    const md = [
      '## Decision',
      '### 1. Supervise',
      '1. A step, not a decision.',
      'Rules: `sup.a`',
      '### 2. Durability',
      'Text.',
      '### Amended: x (2026-11-20)',
      'Rules: `sup.b`',
    ].join('\n');
    expect(unruledSections(md)).toEqual(['decision 2']);
  });

  it('counts each ### section when there are no numbered decisions', () => {
    expect(
      unruledSections('## Decision\n### Ownership\nRules: `a.b`\n### Topics\nText.\n'),
    ).toEqual(['section "Topics"']);
  });

  it('reads Rules: lines', () => {
    expect(readRulesLines('x\nRules: `a.b`, `c.d-e`\nRules:`f.g`\n')).toEqual([
      'a.b',
      'c.d-e',
      'f.g',
    ]);
  });

  it('parses the three ref forms', () => {
    expect(parseRef('adr/0007#x-y')).toEqual({ kind: 'adr', number: '0007', anchor: 'x-y' });
    expect(parseRef('#390')).toEqual({ kind: 'issue', number: 390 });
    expect(parseRef('web#285')).toEqual({ kind: 'issue', repo: 'web', number: 285 });
    expect(parseRef('v0.1.0-next.12')).toEqual({ kind: 'tag', tag: 'v0.1.0-next.12' });
    expect(parseRef('ADR 0007')).toBeUndefined();
    expect(parseRef('adr/0007')).toBeUndefined();
  });

  it('orders versions with prereleases below their release', () => {
    expect(compareVersions('0.2.0-next.3', '0.2.0')).toBe(-1);
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0);
    expect(compareVersions('0.1.1', '0.2.0')).toBe(-1);
    expect(compareVersions('0.2.0-next.10', '0.2.0-next.9')).toBe(1);
  });
});

describe('rules:check', () => {
  it('passes a sound registry', () => {
    expect(messages(input(registry()))).toEqual([]);
  });

  it('passes an empty registry', () => {
    const reg: Registry = {
      concepts: structuredClone(concepts),
      files: [
        { path: 'docs/rules/supervision.json', concept: 'supervision', data: [] },
        { path: 'docs/rules/durability.json', concept: 'durability', data: [] },
      ],
    };
    const a = new Map([['0007', parseAdr('0007-bus-worker-supervision.md', '# ADR 0007\n')!]]);
    expect(messages(input(reg, { adrs: a }))).toEqual([]);
  });

  it('fails on concepts that are broken', () => {
    const reg = registry();
    pushConcept(reg, {
      id: 'supervision',
      prefix: 'sup',
      name: 'X',
      description: 'Y',
      order: 3,
    });
    pushConcept(reg, { id: 'pools', prefix: 'Pool', name: 'Pools', order: 'x' });
    const m = messages(input(reg));
    expect(m).toContainEqual(expect.stringContaining('concept id "supervision" is used twice'));
    expect(m).toContainEqual(expect.stringContaining('prefix "sup" is used twice'));
    expect(m).toContainEqual(expect.stringContaining('"description" must be a non-empty string'));
    expect(m).toContainEqual(expect.stringContaining('"order" must be a number'));
    expect(m).toContainEqual(expect.stringContaining('must be lower-case letters and digits'));
    expect(m).toContainEqual(expect.stringContaining('concept "pools" has no file'));
  });

  it('fails on a file with no concept, bad JSON or no array', () => {
    const reg = registry();
    reg.files.push({ path: 'docs/rules/stray.json', concept: 'stray', data: [] });
    reg.files.push({
      path: 'docs/rules/bad.json',
      concept: 'bad',
      data: { parseError: 'Unexpected token' },
    });
    reg.files.push({ path: 'docs/rules/obj.json', concept: 'obj', data: {} });
    const m = messages(input(reg));
    expect(m).toContainEqual(expect.stringContaining('stray.json: no concept "stray"'));
    expect(m).toContainEqual(expect.stringContaining('bad.json: not valid JSON'));
    expect(m).toContainEqual(expect.stringContaining('obj.json: must be an array of rules'));
  });

  it('fails on a missing or mistyped field', () => {
    expect(withRule((r) => delete r['statement'])).toContainEqual(
      expect.stringContaining('"statement" must be'),
    );
    expect(withRule((r) => (r['status'] = 'done'))).toContainEqual(
      expect.stringContaining('"status" must be one of'),
    );
    expect(withRule((r) => (r['values'] = '3'))).toContainEqual(
      expect.stringContaining('"values" must be an array'),
    );
    expect(withRule((r) => (r['experimental'] = 'yes'))).toContainEqual(
      expect.stringContaining('"experimental" must be'),
    );
    expect(withRule((r) => (r['since'] = 'soon'))).toContainEqual(
      expect.stringContaining('"since" must be a version'),
    );
    expect(withRule((r) => (r['events'] = []))).toContainEqual(
      expect.stringContaining('"events" must be a non-empty'),
    );
    expect(withRule((r) => (r['colour'] = 'blue'))).toContainEqual(
      expect.stringContaining('unknown field "colour"'),
    );
  });

  it('fails on a bad id, an unknown prefix or the wrong file', () => {
    expect(withRule((r) => (r['id'] = 'Sup.Restart'))).toContainEqual(
      expect.stringContaining('id must be <prefix>.<kebab-case-slug>'),
    );
    expect(withRule((r) => (r['id'] = 'zzz.restart'))).toContainEqual(
      expect.stringContaining('prefix "zzz" isn\'t in'),
    );
    expect(withRule((r) => (r['id'] = 'dur.restart'))).toContainEqual(
      expect.stringContaining('belongs in docs/rules/durability.json'),
    );
  });

  it('fails on an id or alias used twice', () => {
    expect(withRule((r) => (r['id'] = 'sup.short-runs'))).toContainEqual(
      expect.stringContaining('"sup.short-runs" is already used'),
    );
    expect(withRule((r) => (r['aliases'] = ['dur.no-replicas']))).toContainEqual(
      expect.stringContaining('"dur.no-replicas" is already used in docs/rules/supervision.json'),
    );
    expect(withRule((r) => (r['aliases'] = ['zzz.old']))).toContainEqual(
      expect.stringContaining('alias "zzz.old" must be'),
    );
  });

  it("fails on related or supersededBy ids that don't exist", () => {
    expect(withRule((r) => (r['related'] = ['sup.nothing']))).toContainEqual(
      expect.stringContaining('related "sup.nothing" doesn\'t exist'),
    );
    const m = withRule((r) => {
      r['status'] = 'superseded';
      r['supersededBy'] = 'sup.nothing';
      delete r['since'];
    });
    expect(m).toContainEqual(expect.stringContaining('supersededBy "sup.nothing" doesn\'t exist'));
  });

  it('accepts an alias in related', () => {
    expect(
      withRule((r) => {
        r['aliases'] = ['sup.bus-limit'];
        r['related'] = ['sup.bus-limit'];
      }),
    ).toEqual([]);
  });

  it('fails on a missing code path', () => {
    const r = rules();
    expect(
      messages(input(registry(r), { exists: (p) => p !== 'packages/host/src/kernel.ts' })),
    ).toContainEqual(
      expect.stringContaining('code path "packages/host/src/kernel.ts" doesn\'t exist'),
    );
  });

  it('fails on events that are broken', () => {
    expect(ev((e) => (e['type'] = 'merged'))).toContainEqual(
      expect.stringContaining('"type" must be one of'),
    );
    expect(ev((e) => (e['date'] = '3 Nov'))).toContainEqual(
      expect.stringContaining('"date" must be YYYY-MM-DD'),
    );
    expect(ev((e) => (e['date'] = '2026-12-01'))).toContainEqual(
      expect.stringContaining('oldest first'),
    );
    expect(ev((e) => (e['why'] = ''))).toContainEqual(expect.stringContaining('"why" must be'));
    expect(ev((e) => (e['note'] = 'x'))).toContainEqual(
      expect.stringContaining('unknown field "note"'),
    );
    expect(ev((e) => (e['ref'] = 'ADR 0007 §1'))).toContainEqual(
      expect.stringContaining('must be adr/NNNN#heading-anchor'),
    );
    expect(ev((e) => (e['ref'] = '#12'))).toContainEqual(
      expect.stringContaining("a decided event's ref must be adr, not issue"),
    );
  });

  it('fails on a clarified or amended event with no prev', () => {
    const m = withRule((r) => delete evs(r)[1]!['prev']);
    expect(m).toContainEqual(expect.stringContaining('a clarified event needs "prev"'));
    const n = withRule((r) => (evs(r)[1]!['type'] = 'amended'));
    expect(n).toEqual([]);
  });

  it('fails on an ADR ref to a missing file or heading', () => {
    expect(withRule((r) => (evs(r)[0]!['ref'] = 'adr/0099#decision'))).toContainEqual(
      expect.stringContaining('no ADR 0099 in docs/adr'),
    );
    expect(withRule((r) => (evs(r)[0]!['ref'] = 'adr/0007'))).toContainEqual(
      expect.stringContaining('ref "adr/0007" must be adr/NNNN#heading-anchor'),
    );
    expect(withRule((r) => (evs(r)[0]!['ref'] = 'adr/0007#2-nothing'))).toContainEqual(
      expect.stringContaining('no heading #2-nothing in 0007-bus-worker-supervision.md'),
    );
  });

  it('fails on a Rules: line naming an unknown id', () => {
    const a = new Map([
      ['0007', parseAdr('0007-bus-worker-supervision.md', `${ADR_7}\nRules: \`sup.gone\`\n`)!],
    ]);
    expect(messages(input(registry(), { adrs: a }))).toContainEqual(
      expect.stringContaining(
        'docs/adr/0007-bus-worker-supervision.md: Rules: line names "sup.gone"',
      ),
    );
  });

  it("fails when the status doesn't match the fields and events", () => {
    expect(withRule((r) => delete r['since'])).toContainEqual(
      expect.stringContaining('an active rule needs "since"'),
    );
    expect(
      withRule((r) => {
        const list: unknown = r['events'];
        if (Array.isArray(list)) list.pop();
      }),
    ).toContainEqual(expect.stringContaining('an active rule needs a shipped event'));
    expect(withRule((r) => delete r['target'], 1)).toContainEqual(
      expect.stringContaining('a decided rule needs "target"'),
    );
    expect(withRule((r) => (r['target'] = '0.3.0'))).toContainEqual(
      expect.stringContaining('only a decided or proposed rule has "target"'),
    );
    expect(withRule((r) => (r['status'] = 'withdrawn'))).toContainEqual(
      expect.stringContaining('a withdrawn rule needs a withdrawn event'),
    );
    const rejected = rules();
    raw(rejected.dur[0]!.events[0])['type'] = 'removed';
    expect(messages(input(registry(rejected)))).toContainEqual(
      expect.stringContaining('a rejected rule needs a rejected event'),
    );
    expect(withRule((r) => (r['status'] = 'superseded'))).toContainEqual(
      expect.stringContaining('a superseded rule needs "supersededBy"'),
    );
    expect(
      withRule((r) => {
        r['status'] = 'superseded';
        r['supersededBy'] = 'sup.short-runs';
      }),
    ).toContainEqual(expect.stringContaining('a superseded rule needs a superseded event'));
    expect(
      withRule((r) => {
        r['status'] = 'superseded';
        r['supersededBy'] = 'sup.short-runs';
        pushEvent(r, {
          type: 'superseded',
          date: '2026-11-25',
          ref: 'adr/0007#decision',
          why: 'Replaced.',
        });
      }),
    ).toEqual([]);
    expect(
      withRule((r) => {
        pushEvent(r, { type: 'superseded', date: '2026-11-25', ref: '#12', why: 'Replaced.' });
      }),
    ).toContainEqual(expect.stringContaining("a superseded event's ref must be adr, not issue"));
    expect(withRule((r) => (r['supersededBy'] = 'sup.short-runs'))).toContainEqual(
      expect.stringContaining('only a superseded rule has "supersededBy"'),
    );
  });

  it('fails an ADR from 0026 on with a decision that has no Rules: line, not an older one', () => {
    const md =
      '# ADR\n\n## Decision\n\n1. **One.**\n\n   Rules: `sup.restart-limit`\n\n2. **Two.**\n';
    const a = new Map([
      ['0007', parseAdr('0007-bus-worker-supervision.md', ADR_7)!],
      ['0026', parseAdr('0026-rules.md', md)!],
      ['0001', parseAdr('0001-old.md', md)!],
    ]);
    expect(messages(input(registry(), { adrs: a }))).toEqual([
      'docs/adr/0026-rules.md: decision 2 has no Rules: line',
    ]);
  });

  it('holds a repo rule to a built event and no versions', () => {
    expect(repo(() => {})).toEqual([]);
    expect(repo((r) => (r['repo'] = 'yes'))).toContainEqual(
      expect.stringContaining('"repo" must be true or false'),
    );
    expect(repo((r) => (r['since'] = '0.1.0'))).toContainEqual(
      expect.stringContaining('a repo rule has no "since"'),
    );
    expect(repo((r) => (r['target'] = '0.2.0'))).toContainEqual(
      expect.stringContaining('a repo rule has no "target"'),
    );
    expect(
      repo((r) => pushEvent(r, { type: 'shipped', date: '2026-11-30', ref: 'v0.2.0', why: 'x' })),
    ).toContainEqual(expect.stringContaining('a repo rule has no shipped event'));
    expect(
      repo((r) => {
        const list: unknown = r['events'];
        if (Array.isArray(list)) list.pop();
      }),
    ).toContainEqual(expect.stringContaining('an active repo rule needs a built event'));
    expect(
      repo((r) => {
        r['status'] = 'decided';
        const list: unknown = r['events'];
        if (Array.isArray(list)) list.pop();
      }),
    ).toEqual([]);
  });

  it('fails a version PR that leaves a rule waiting on its version', () => {
    expect(messages(input(registry(), { version: '0.2.0' }))).toContainEqual(
      expect.stringContaining(
        'sup.short-runs: target 0.2.0 is reached (packages are at 0.2.0): run pnpm rules:ship 0.2.0',
      ),
    );
    expect(messages(input(registry(), { version: '0.2.0-next.9' }))).toEqual([]);
  });

  it('fails when the README is out of date', () => {
    expect(messages(input(registry(), { readme: '# Rules\n' }))).toEqual([
      'docs/rules/README.md: out of date: run pnpm rules:build',
    ]);
    expect(messages(input(registry(), { readme: undefined }))).toHaveLength(1);
  });
});

describe('rules:build', () => {
  it('shows a repo rule as in force since its PR', () => {
    const r = rules();
    const rule = raw(r.sup[1]);
    rule['repo'] = true;
    rule['status'] = 'active';
    delete rule['target'];
    const md = renderReadme(registry(r), adrs());
    expect(md).toContain(
      '| active, repo | in force since [#430](https://github.com/isoloop/isoloop/issues/430) |',
    );
  });

  it("writes a section per concept, a table and each rule's history", () => {
    const md = renderReadme(registry(), adrs());
    expect(md).toContain('## Supervision');
    expect(md).toContain(
      '| `sup.restart-limit` | The bus worker restarts at most `maxRestarts` times in `withinMs`. | `3 restarts`, `60 000 ms` | active | since `0.1.0` |',
    );
    expect(md).toContain(
      '| `sup.short-runs` | A crash after a short healthy run counts. |  | decided | target `0.2.0` |',
    );
    expect(md).toContain('- **Why:** A default, not a fixed limit.');
    expect(md).toContain(
      '- 2026-11-20 · clarified · [ADR 0007 · Amended: the restart limit is a default (2026-11-20)](../adr/0007-bus-worker-supervision.md#amended-the-restart-limit-is-a-default-2026-11-20) · A default, not a fixed limit. Before: Read as a fixed 3 in 60 s.',
    );
    expect(md).toContain('[#430](https://github.com/isoloop/isoloop/issues/430)');
    expect(md).toContain('[v0.1.0](https://github.com/isoloop/isoloop/releases/tag/v0.1.0)');
  });

  it('inlines the data into the board, escaping `</`', () => {
    const r = rules();
    r.sup[0]!.statement = 'A </script> in a statement.';
    const html = renderBoard(
      {
        shell: '<title>/*TITLE*/</title><style>/*STYLES*/</style><script>/*SCRIPTS*/</script>',
        css: [],
        js: ['const D = /*RULES_DATA*/null;'],
      },
      boardData(registry(r), adrs()),
    );
    expect(html).not.toContain('</script> in');
    expect(html).toContain('\\u003c/script> in');
    const data: unknown = JSON.parse(
      html.slice(html.indexOf('= ') + 2, html.indexOf(';\nRules.start();')),
    );
    expect(data).toMatchObject({
      refs: {
        'adr/0007#1-supervise-the-bus-like-an-isolate': {
          label: 'ADR 0007 · 1. Supervise the bus like an isolate',
          url: 'https://github.com/isoloop/isoloop/blob/main/docs/adr/0007-bus-worker-supervision.md#1-supervise-the-bus-like-an-isolate',
        },
      },
    });
  });

  it('refuses sources with a placeholder missing', () => {
    expect(() => renderBoard({ shell: '<p>no data</p>', css: [], js: ['x'] }, {})).toThrow(
      /placeholder/,
    );
    expect(() =>
      renderBoard({ shell: '<p>no marks</p>', css: [], js: ['/*RULES_DATA*/null'] }, {}),
    ).toThrow(/placeholder/);
  });

  it('builds the real page: the shell, then every view, then start()', () => {
    const src = readBoardSources();
    const html = renderBoard(src, boardData(registry(), adrs()), 'A & B');
    expect(html).toContain('<title>A &amp; B</title>');
    expect(html).not.toMatch(/\/\*(TITLE|STYLES|SCRIPTS|RULES_DATA)\*\//);
    for (const id of ['board', 'agenda']) expect(html).toContain(`id: '${id}'`);
    expect(html.indexOf('const Rules =')).toBeLessThan(html.indexOf("id: 'board'"));
    expect(html.trimEnd()).toMatch(/Rules\.start\(\);\s*<\/script>\s*<\/body>\s*<\/html>$/);
  });

  it('adds the derived model and the keywords to the page data', () => {
    const r = rules();
    const data = boardData(
      {
        ...registry(r),
        keywords: [
          { id: 'crash-loop', label: 'Crash loop', definition: 'Keeps crashing.', aliases: [] },
        ],
      },
      adrs(),
    );
    expect(data).toMatchObject({
      keywords: [{ id: 'crash-loop' }],
      model: { keywordRules: { 'crash-loop': [] } },
    });
  });
});

describe('rules:ship', () => {
  it('turns a target into since, adds a shipped event, and passes the check after', () => {
    const reg = registry();
    expect(messages(input(reg, { version: '0.2.0' }))).not.toEqual([]);
    const shipped = ship(reg, '0.2.0', '2026-12-10');
    expect([...shipped]).toEqual([['docs/rules/supervision.json', ['sup.short-runs']]]);
    const r = rulesIn(reg.files[0]!.data)[1]!;
    expect(r.status).toBe('active');
    expect(r.since).toBe('0.2.0');
    expect('target' in r).toBe(false);
    expect(Object.keys(r)).toEqual(['id', 'statement', 'status', 'since', 'events']);
    expect(r.events.at(-1)).toEqual({
      type: 'shipped',
      date: '2026-12-10',
      ref: 'v0.2.0',
      why: 'First released in 0.2.0.',
    });
    expect(messages(input(reg, { version: '0.2.0' }))).toEqual([]);
  });

  it('skips repo rules', () => {
    const r = rules();
    raw(r.sup[1])['repo'] = true;
    const reg = registry(r);
    expect(ship(reg, '0.2.0', '2026-12-10').size).toBe(0);
  });

  it('leaves rules with another target alone', () => {
    const reg = registry();
    expect(ship(reg, '0.3.0', '2026-12-10').size).toBe(0);
    expect(rulesIn(reg.files[0]!.data)[1]!.status).toBe('decided');
  });
});

const sup = (ids: string[]) => JSON.stringify(ids.map((id) => ({ id })));
const WITH_LINES = `# ADR\n\nRules: \`sup.restart-limit\`\n`;

function runPr(opts: {
  labels?: string[];
  changed: string[];
  files: Record<string, { base?: string; head?: string }>;
}) {
  const files = opts.files;
  const ruleFiles = Object.keys(files).filter(
    (p) => p.startsWith('docs/rules/') && p.endsWith('.json'),
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
        'docs/rules/supervision.json': rulesFile,
      },
    });
    expect(d.ok).toBe(false);
    expect(!d.ok && d.errors[0]).toContain("docs/adr/0007-bus.md changed, but docs/rules/ didn't");
  });

  it('passes it with a rules change, or the no-rules label', () => {
    const files = {
      'docs/adr/0007-bus.md': { base: WITH_LINES, head: `${WITH_LINES}more\n` },
      'docs/rules/supervision.json': rulesFile,
    };
    expect(
      runPr({ changed: ['docs/adr/0007-bus.md', 'docs/rules/supervision.json'], files }).ok,
    ).toBe(true);
    expect(runPr({ changed: ['docs/adr/0007-bus.md'], files, labels: ['no-rules'] }).ok).toBe(true);
  });

  it('skips ADRs with no Rules: lines until the backfill reaches them, and the index', () => {
    const d = runPr({
      changed: ['docs/adr/0001-one.md', 'docs/adr/README.md'],
      files: {
        'docs/adr/0001-one.md': { base: '# ADR\n', head: '# ADR\nmore\n' },
        'docs/rules/supervision.json': rulesFile,
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
    expect(!noLines.ok && noLines.errors[0]).toContain("docs/rules/ didn't");
    const missing = runPr({
      changed: ['docs/adr/0031-new.md', 'docs/rules/supervision.json'],
      files: {
        'docs/adr/0031-new.md': { head: md },
        'docs/rules/supervision.json': { base: '[]', head: JSON.stringify([{ id: 'sup.a' }]) },
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
      changed: ['docs/rules/supervision.json'],
      files: {
        'docs/rules/supervision.json': { base: sup(['sup.a', 'sup.b']), head: sup(['sup.a']) },
      },
    });
    expect(gone.ok).toBe(false);
    expect(!gone.ok && gone.errors[0]).toContain('Rule ids removed: sup.b');
    const renamed = runPr({
      changed: ['docs/rules/supervision.json'],
      files: {
        'docs/rules/supervision.json': {
          base: sup(['sup.a', 'sup.b']),
          head: JSON.stringify([{ id: 'sup.a' }, { id: 'sup.c', aliases: ['sup.b'] }]),
        },
      },
    });
    expect(renamed.ok).toBe(true);
    const moved = runPr({
      changed: ['docs/rules/supervision.json', 'docs/rules/durability.json'],
      files: {
        'docs/rules/supervision.json': { base: sup(['sup.a']), head: sup([]) },
        'docs/rules/durability.json': {
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
});

const rule = (id: string, over: Partial<Rule> = {}): Rule => ({
  id,
  statement: 'A rule.',
  status: 'active',
  events: [{ type: 'decided', date: '2026-11-03', ref: 'adr/0007#one', why: 'Because.' }],
  ...over,
});

describe('the derived model', () => {
  it('takes symbols from backticks in the statement and knob, and the errors', () => {
    const r = rule('sup.a', {
      statement: 'Restarts at most `maxRestarts` times, then `isolate failed` and `main`.',
      knob: '`KernelConfig.supervisor`',
      errors: ['bus_unavailable'],
    });
    expect(symbolsOf(r, new Set(['main']))).toEqual([
      'maxRestarts',
      'KernelConfig.supervisor',
      'bus_unavailable',
    ]);
  });

  it('reads the ADR sections a rule cites, anchors only', () => {
    const r = rule('sup.a', {
      events: [
        { type: 'decided', date: '2026-11-03', ref: 'adr/0007#one', why: 'x' },
        { type: 'built', date: '2026-11-04', ref: '#12', why: 'x' },
        { type: 'amended', date: '2026-11-05', ref: 'adr/0007#one', why: 'x', prev: 'y' },
      ],
    });
    expect(sectionsOf(r)).toEqual(['adr/0007#one']);
  });

  it('links written pairs once with weight 1, through aliases', () => {
    const a = rule('sup.a', { related: ['sup.old-b'] });
    const b = rule('sup.b', { aliases: ['sup.old-b'], related: ['sup.a'] });
    const { links } = deriveLinks([a, b], { cap: 12, symbols: {} });
    const related = links.filter((l) => l.kind === 'related');
    expect(related).toEqual([{ a: 'sup.a', b: 'sup.b', kind: 'related', weight: 1, keys: [] }]);
  });

  it('weighs a shared key 1/(n−1) and lists a key past the cap', () => {
    const three = ['sup.a', 'sup.b', 'sup.c'].map((id) => rule(id, { code: ['x.ts'] }));
    const { links } = deriveLinks(three, { cap: 12, symbols: {} });
    const code = links.filter((l) => l.kind === 'code');
    expect(code).toHaveLength(3);
    for (const l of code) expect(l.weight).toBeCloseTo(0.5);
    const many = Array.from({ length: 4 }, (_, i) => rule(`sup.r${i}`, { code: ['k.ts'] }));
    const capped = deriveLinks(many, { cap: 3, symbols: {} });
    expect(capped.links.filter((l) => l.kind === 'code')).toEqual([]);
    expect(capped.tooCommon.filter((k) => k.kind === 'code')).toEqual([
      { kind: 'code', key: 'k.ts', rules: 4 },
    ]);
  });

  it('adds up the weights of several shared keys of one kind', () => {
    const a = rule('sup.a', { code: ['x.ts', 'y.ts'] });
    const b = rule('sup.b', { code: ['x.ts', 'y.ts'] });
    const { links } = deriveLinks([a, b], { cap: 12, symbols: {} });
    expect(links.find((l) => l.kind === 'code')).toMatchObject({
      weight: 2,
      keys: ['x.ts', 'y.ts'],
    });
    const sec = links.find((l) => l.kind === 'section');
    expect(sec).toMatchObject({ keys: ['adr/0007#one'], weight: 1 });
  });

  it("lists each keyword's rules, with no rules for an unused keyword", () => {
    const vocab = [
      { id: 'crash-loop', label: 'Crash loop', definition: 'x', aliases: [] },
      { id: 'tabs', label: 'Tabs', definition: 'x', aliases: [] },
    ];
    const rs = [
      rule('sup.a', { keywords: ['crash-loop'] }),
      rule('sup.b', { keywords: ['crash-loop'] }),
    ];
    expect(keywordRules(rs, vocab)).toEqual({ 'crash-loop': ['sup.a', 'sup.b'], tabs: [] });
    expect(
      buildModel(rs, vocab, { cap: 12, symbolsIgnore: [] }).keywordRules['crash-loop'],
    ).toEqual(['sup.a', 'sup.b']);
  });

  it("ties keywords by shared rules, weighted by √(n_a × n_b), keeping each one's strongest", () => {
    const edges = keywordEdges({ a: ['r1', 'r2'], b: ['r1', 'r2', 'r3', 'r4'], c: ['r9'], d: [] });
    expect(edges).toEqual([{ a: 'a', b: 'b', shared: 2, weight: 2 / Math.sqrt(8) }]);
    const many = Object.fromEntries(
      ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map((k) => [k, ['shared', k]]),
    );
    const capped = keywordEdges(many, 2);
    for (const k of Object.keys(many))
      expect(capped.filter((e) => e.a === k || e.b === k).length).toBeGreaterThanOrEqual(1);
    expect(capped.length).toBeLessThan(15);
  });

  it('places keywords the same way every time, inside the plane, skipping unused ones', () => {
    const counts = { a: 5, b: 2, c: 1, unused: 0 };
    const edges = keywordEdges({ a: ['r1', 'r2'], b: ['r1', 'r2'], c: ['r3'] });
    const labels = { a: 'A', b: 'B', c: 'C' };
    const one = layoutKeywords(counts, edges, labels);
    expect(one).toEqual(layoutKeywords(counts, edges, labels));
    expect(one.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    for (const n of one) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1000);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(600);
    }
    expect(one.find((n) => n.id === 'a')!.r).toBeGreaterThan(one.find((n) => n.id === 'c')!.r);
    expect(layoutKeywords({}, [], {})).toEqual([]);
    expect(keywordGraph({}, []).nodes).toEqual([]);
  });

  it('finds rules in other concepts sharing keywords, rare keywords first', () => {
    const rs = [
      rule('sup.a', { keywords: ['rare', 'common'] }),
      rule('sup.b', { keywords: ['rare', 'common'] }),
      rule('bus.c', { keywords: ['common'] }),
      rule('dur.d', { keywords: ['rare'] }),
      rule('bus.e', { keywords: ['common'] }),
      rule('bus.f', { keywords: ['common'] }),
      rule('iso.g'),
    ];
    const by = keywordRules(rs, [
      { id: 'rare', label: 'Rare', definition: 'x', aliases: [] },
      { id: 'common', label: 'Common', definition: 'x', aliases: [] },
    ]);
    const near = keywordNeighbours(rs, by, 2);
    expect(near['sup.a']!.map((n) => n.id)).toEqual(['dur.d', 'bus.c']);
    expect(near['sup.a']![0]).toMatchObject({ keywords: ['rare'] });
    expect(near['sup.a']!.some((n) => n.id === 'sup.b')).toBe(false);
    expect(near['iso.g']).toBeUndefined();
  });
});

const at = (concept: string, r: Rule) => ({ concept, rule: r });

describe('the Sources model', () => {
  it("flows each rule from its first ADR event's ADR into its concept, split by that event's type", () => {
    const flows = sourceFlows([
      at('sup', rule('sup.a')),
      at('sup', rule('sup.b')),
      at('dur', rule('dur.a')),
      at(
        'sup',
        rule('sup.c', {
          status: 'rejected',
          events: [{ type: 'rejected', date: '2026-11-03', ref: 'adr/0007#alt', why: 'x' }],
        }),
      ),
      at(
        'ver',
        rule('ver.a', {
          repo: true,
          events: [{ type: 'built', date: '2026-11-03', ref: '#9', why: 'x' }],
        }),
      ),
    ]);
    expect(flows.map((f) => [f.adr, f.concept, f.type, f.rules])).toEqual([
      ['', 'ver', 'none', ['ver.a']],
      ['0007', 'sup', 'decided', ['sup.a', 'sup.b']],
      ['0007', 'dur', 'decided', ['dur.a']],
      ['0007', 'sup', 'rejected', ['sup.c']],
    ]);
    expect(sourceOf(rule('x.a', { events: [] }))).toBeNull();
  });

  it('lists every cited path once per rule, most cited first', () => {
    const paths = codePaths([
      rule('sup.a', { code: ['a.ts', 'b/'] }),
      rule('sup.b', { code: ['a.ts', 'a.ts'] }),
    ]);
    expect(paths).toEqual([
      { path: 'a.ts', rules: ['sup.a', 'sup.b'] },
      { path: 'b/', rules: ['sup.a'] },
    ]);
  });

  it('finds where the registry is weak, from the registry and the ADR files alone', () => {
    const rs = [
      at('sup', rule('sup.a', { code: ['a.ts'], keywords: ['k'] })),
      at('sup', rule('sup.b')),
      at('dur', rule('dur.a', { status: 'decided', target: '0.2.0' })),
      at(
        'dur',
        rule('dur.b', {
          status: 'rejected',
          events: [{ type: 'rejected', date: '2026-11-03', ref: 'adr/0007#one', why: 'x' }],
        }),
      ),
      at(
        'ver',
        rule('ver.a', {
          repo: true,
          events: [{ type: 'built', date: '2026-11-03', ref: '#9', why: 'x' }],
        }),
      ),
    ];
    const tooCommon = [{ kind: 'section' as const, key: 'adr/0007#one', rules: 20 }];
    const links = [{ a: 'sup.a', b: 'dur.a', kind: 'related' as const, weight: 1, keys: [] }];
    const adrFiles = [
      { file: '0007-bus.md', hasRules: true },
      { file: '0012-built-apart.md', hasRules: false },
    ];
    const by = Object.fromEntries(
      healthChecks(rs, adrFiles, tooCommon, links).map((h) => [h.id, h]),
    );
    expect(by['no-code']?.rules).toEqual(['sup.b', 'dur.a', 'ver.a']);
    expect(by['no-built']?.rules).toEqual(['sup.a', 'sup.b']);
    expect(by['coarse-anchor']?.rules).toEqual(['sup.a', 'sup.b', 'dur.a']);
    expect(by['no-keywords']?.rules).toEqual(['sup.b', 'dur.a', 'ver.a']);
    expect(by['adr-no-rules']?.items).toEqual(['0012-built-apart.md']);
    expect(by['concept-unlinked']?.items).toEqual(['ver']);
  });

  it('builds all three for the page', () => {
    const rs = [at('sup', rule('sup.a', { code: ['a.ts'] }))];
    const s = buildSources(rs, [], { links: [], tooCommon: [] });
    expect(s.flows).toHaveLength(1);
    expect(s.code).toEqual([{ path: 'a.ts', rules: ['sup.a'] }]);
    expect(s.health.map((h) => h.id)).toEqual([
      'no-code',
      'no-built',
      'coarse-anchor',
      'no-keywords',
      'adr-no-rules',
      'concept-unlinked',
    ]);
  });
});

describe('as of (amended 2026-11-28)', () => {
  const shipped = rule('sup.a', {
    status: 'active',
    since: '0.1.0',
    statement: 'Restarts 3 times, then fails.',
    events: [
      { type: 'decided', date: '2026-11-03', ref: 'adr/0007#one', why: 'x' },
      { type: 'built', date: '2026-11-05', ref: '#12', why: 'x' },
      { type: 'shipped', date: '2026-11-23', ref: 'v0.1.0', why: 'x' },
      {
        type: 'amended',
        date: '2026-11-24',
        ref: 'adr/0007#one',
        why: 'x',
        prev: 'Restarts 3 times in 60 s.',
      },
    ],
  });

  it('rebuilds status, since and wording per day, from the events and `prev`', () => {
    expect(historyOf(shipped)).toEqual([
      { date: '2026-11-03', status: 'decided', statement: 'Restarts 3 times in 60 s.' },
      {
        date: '2026-11-23',
        status: 'active',
        statement: 'Restarts 3 times in 60 s.',
        since: '0.1.0',
      },
      {
        date: '2026-11-24',
        status: 'active',
        statement: 'Restarts 3 times, then fails.',
        since: '0.1.0',
      },
    ]);
  });

  it('makes a repo rule active on its built event, and takes one snapshot per day', () => {
    const repoRule = rule('tool.a', {
      repo: true,
      status: 'active',
      events: [
        { type: 'decided', date: '2026-11-27', ref: 'adr/0026#one', why: 'x' },
        { type: 'built', date: '2026-11-27', ref: '#483', why: 'x' },
      ],
    });
    expect(historyOf(repoRule).map((s) => [s.date, s.status])).toEqual([['2026-11-27', 'active']]);
  });

  it('ends on the rule as stored', () => {
    const r = rule('sup.b', {
      status: 'withdrawn',
      events: [
        { type: 'decided', date: '2026-11-20', ref: 'adr/0001#w', why: 'x' },
        { type: 'corrected', date: '2026-11-22', ref: 'adr/0001#w', why: 'x' },
        { type: 'withdrawn', date: '2026-11-22', ref: 'adr/0001#w', why: 'x' },
      ],
    });
    const h = historyOf(r);
    expect(h[h.length - 1]).toMatchObject({ status: 'withdrawn', statement: r.statement });
  });

  it('names each day with events, the release shipped that day, and today', () => {
    const other = rule('sup.c', {
      events: [{ type: 'decided', date: '2026-11-28', ref: 'adr/0007#one', why: 'x' }],
    });
    expect(pointsOf([shipped, other])).toEqual([
      { id: '2026-11-03', date: '2026-11-03' },
      { id: '2026-11-05', date: '2026-11-05' },
      { id: 'v0.1.0', date: '2026-11-23', tag: 'v0.1.0' },
      { id: '2026-11-24', date: '2026-11-24' },
      { id: 'today', date: '2026-11-28' },
    ]);
  });

  it('keeps every rule in the registry consistent with its own history', () => {
    const reg = readRegistry(REPO_ROOT);
    for (const { rule: r } of rulesOf(reg)) {
      const h = historyOf(r);
      expect(h.length, r.id).toBeGreaterThan(0);
      for (let i = 1; i < h.length; i++)
        expect(h[i]!.date > h[i - 1]!.date, `${r.id}: dates ascend`).toBe(true);
    }
  });
});

const vocab = [
  {
    id: 'crash-loop',
    label: 'Crash loop',
    definition: 'Keeps crashing.',
    aliases: ['restart limit'],
  },
];
const run = (keywords: unknown, change: (r: Raw) => void = () => {}): string[] => {
  const r = rules();
  change(raw(r.sup[0]));
  const reg = { ...registry(r), keywords };
  return messages(input(reg));
};

describe('keywords in rules:check', () => {
  it('passes a rule naming a known keyword', () => {
    expect(run(vocab, (r) => (r['keywords'] = ['crash-loop']))).toEqual([]);
  });

  it('fails on an unknown keyword', () => {
    expect(run(vocab, (r) => (r['keywords'] = ['nope']))).toContain(
      'docs/rules/supervision.json: sup.restart-limit: keyword "nope" isn\'t in docs/rules/keywords.json',
    );
  });

  it('fails on a malformed vocabulary', () => {
    const out = run([
      { id: 'Bad Id', label: '', aliases: 'x', extra: 1 },
      { id: 'tabs', label: 'Tabs', definition: 'x', aliases: [] },
      { id: 'tabs', label: 'Tabs', definition: 'x', aliases: [] },
    ]);
    expect(out).toEqual(
      expect.arrayContaining([
        'docs/rules/keywords.json: keyword 1: unknown field "extra"',
        'docs/rules/keywords.json: keyword 1: "label" must be a non-empty string',
        'docs/rules/keywords.json: keyword 1: "definition" must be a non-empty string',
        'docs/rules/keywords.json: keyword 1: "aliases" must be an array of strings',
        'docs/rules/keywords.json: keyword 1: id must be kebab-case',
        'docs/rules/keywords.json: keyword id "tabs" is used twice',
      ]),
    );
    expect(run({ parseError: 'bad' })).toContain('docs/rules/keywords.json: not valid JSON: bad');
    expect(run({})).toContain('docs/rules/keywords.json: must be an array of keywords');
  });

  it('fails on a rule whose keywords field is not a list of strings', () => {
    expect(run(vocab, (r) => (r['keywords'] = 'crash-loop'))).toContain(
      'docs/rules/supervision.json: sup.restart-limit: "keywords" must be an array of strings',
    );
  });
});

describe('the config', () => {
  it('merges over the defaults', () => {
    const c = parseConfig({ title: 'X rules', github: { owner: 'o' }, links: { cap: 20 } });
    expect(c.title).toBe('X rules');
    expect(c.github).toEqual({ owner: 'o', repo: '' });
    expect(c.links.cap).toBe(20);
    expect(c.rulesDir).toBe('docs/rules');
  });

  it('refuses unknown fields and wrong types', () => {
    expect(() => parseConfig({ nope: 1 })).toThrow(/unknown field "nope"/);
    expect(() => parseConfig({ title: 3 })).toThrow(/"title" must be a string/);
    expect(() => parseConfig({ github: { owner: 1 } })).toThrow(/"github.owner" must be a string/);
    expect(() => parseConfig({ github: { x: 'y' } })).toThrow(/unknown field "github.x"/);
    expect(() => parseConfig({ symbolsIgnore: [1] })).toThrow(/array of strings/);
    expect(() => parseConfig([])).toThrow(/must be an object/);
  });
});
