// docs:check's rules, each failing on its own fixture (M4c task 3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkCoverage,
  checkApiPages,
  checkHistory,
  checkLinks,
  checkShape,
  checkWords,
  mapNotices,
  parseWritingRules,
  type DocsMap,
  type WritingRules,
} from './check.ts';
import type { ApiExport, ApiModel, ExportKind } from './read-api.ts';

const rules: WritingRules = parseWritingRules(
  readFileSync(join(import.meta.dirname, '../../docs/writing.md'), 'utf8'),
);

const guide = (o: { lead?: string; h2?: string[]; before?: string } = {}): string =>
  [
    o.before ?? '',
    '# A guide',
    '',
    o.lead ?? 'One sentence about the page, for the reader.',
    '',
    ...(o.h2 ?? ['When to use it', 'Doing it', 'Limits', 'See also']).flatMap((h) => [
      `## ${h}`,
      '',
      'Text.',
      '',
    ]),
  ].join('\n');

const messages = (ps: { message: string }[]): string[] => ps.map((p) => p.message);

const shape = (md: string): string[] => messages(checkShape('g.md', md, rules, { skeleton: true }));

const exists = (p: string): boolean => ['docs/guide/pools.md', 'docs/adr/0001-x.md'].includes(p);

const words = (md: string): string[] => messages(checkWords('g.md', md, rules));

describe('the rules come from docs/writing.md', () => {
  it('reads the banned phrases, the em dash rule and the skeleton', () => {
    expect(rules.banned).toContain('simply');
    expect(rules.banned).toContain('faster than native');
    expect(rules.noEmDash).toBe(true);
    expect(rules.skeleton).toEqual({ first: ['When to use it'], last: ['Limits', 'See also'] });
  });

  it('fails loudly when a section is missing', () => {
    expect(() => parseWritingRules('# Writing\n')).toThrow(/Banned phrases/);
  });
});

describe('item 1: the skeleton and the lead', () => {
  it('passes a guide in shape', () => {
    expect(shape(guide())).toEqual([]);
  });

  it('needs the title as the only h1, first', () => {
    expect(shape(guide({ before: 'Intro.\n' }))).toEqual([
      'a guide starts with its title as the only `# h1`',
    ]);
    expect(shape(`${guide()}\n# Another\n`)).toEqual([
      'a guide starts with its title as the only `# h1`',
    ]);
  });

  it('needs a lead of one sentence, at most 200 characters', () => {
    expect(shape(guide({ lead: '- a list' }))).toEqual([
      'the h1 is followed by a one-sentence lead paragraph',
    ]);
    expect(shape(guide({ lead: 'One. Two.' }))).toEqual(['the lead is one sentence (found 2)']);
    expect(shape(guide({ lead: 'No full stop' }))).toEqual(['the lead is one sentence (found 0)']);
    expect(shape(guide({ lead: `${'word '.repeat(45)}end.` }))[0]).toMatch(
      /at most 200 characters/,
    );
  });

  it("counts the lead as a reader sees it: code and link targets don't count", () => {
    expect(shape(guide({ lead: 'Use `a.b()` with [the guide](pools.md#a.b).' }))).toEqual([]);
  });

  it('needs "When to use it" first and "Limits", "See also" last', () => {
    expect(shape(guide({ h2: ['Doing it', 'Limits', 'See also'] }))).toEqual([
      'the first h2 is "## When to use it"',
    ]);
    expect(shape(guide({ h2: ['When to use it', 'See also', 'Limits'] }))).toEqual([
      'the last h2s are "## Limits", "## See also", in that order',
    ]);
  });

  it('ignores headings inside code fences', () => {
    expect(
      shape(
        guide({ h2: ['When to use it', 'Doing it', 'Limits', 'See also'] }).replace(
          'Text.',
          '```md\n# Not a title\n```',
        ),
      ),
    ).toEqual([]);
  });
});

const links = (md: string): string[] => messages(checkLinks('docs/guide/g.md', md, exists));

describe('item 3: relative links', () => {
  it('passes links that resolve, anchors, external links and links in code', () => {
    expect(
      links(
        '[a](pools.md) [b](pools.md#x) [c](../adr/0001-x.md) [d](#here) [e](https://x.dev) `[f](nope.md)`\n```\n[g](nope.md)\n```',
      ),
    ).toEqual([]);
  });

  it('fails a link to nothing, with its line', () => {
    expect(links('Text.\n[a](pool.md)\n\n[b]: ../adr/none.md')).toEqual([
      'line 2: the link "pool.md" resolves to nothing',
      'line 4: the link "../adr/none.md" resolves to nothing',
    ]);
  });
});

const history = (md: string): string[] => messages(checkHistory('docs/guide/g.md', md));
const apiPage = (md: string): string[] =>
  messages(checkApiPages([{ file: 'docs/api/host.md', md }]));

describe('item 3b: how it works, not why it was decided', () => {
  it('fails a link into the ADRs or the plans, relative or absolute', () => {
    expect(history('See [the decision](../adr/0001-x.md).')).toHaveLength(1);
    expect(history('See [ADR 0001](../adr/0001-x.md).')).toHaveLength(2);
    expect(history('[the plan](../plans/m4c-docs.md)')).toHaveLength(1);
    expect(
      history('[x](https://github.com/isoloop/isoloop/blob/main/docs/adr/0001-x.md)'),
    ).toHaveLength(1);
  });

  it('fails an ADR named in the prose', () => {
    expect(history('As ADR 0015 says.')).toHaveLength(1);
    expect(history('ADRs 0007 and 0008')).toHaveLength(1);
    expect(history('See ADR-0001, or ADR 17.')).toHaveLength(1);
  });

  it('holds for the generated API pages too', () => {
    expect(
      apiPage('# @isoloop/host\n\nThe lead.\n\nThe tools exposed (ADR 0018, decision 2).'),
    ).toEqual(["line 5: public docs don't name ADRs; say how it works, not why it was decided"]);
    expect(apiPage('# @isoloop/host\n\nThe lead.\n\n```ts nocheck\n// ADR 0001\n```')).toEqual([]);
  });

  it('passes ADRs in code and other links', () => {
    expect(
      history(
        'Pools are in [pools](pools.md) and [the bench](../../bench/pools/README.md). `ADR 0001`\n```\n// ADR 0001\n[a](../adr/0001-x.md)\n```',
      ),
    ).toEqual([]);
  });
});

describe('item 4: banned phrases and em dashes', () => {
  it('fails a banned word or phrase, ignoring case', () => {
    expect(words('Simply call it.\nIt is Faster  than native.')).toEqual([
      'line 1: "simply" is banned',
      'line 2: "faster than native" is banned',
    ]);
  });

  it('matches whole words, outside code and link targets', () => {
    expect(words('Justify it. `just` [x](just.md)\n```\njust\n```')).toEqual([]);
  });

  it('fails an em dash in prose', () => {
    expect(words('This — that.')).toEqual(['line 1: no em dashes']);
    expect(words('`a — b`')).toEqual([]);
  });
});

// A small API: `make` (a value) refers to `Opts` (a type); `Opts` refers to
// `Deep`; `Other` and `helper` are unreached.
const x = (name: string, kind: ExportKind, entry = 'pkg'): ApiExport => ({
  name,
  kind,
  key: `k:${name}`,
  home: entry,
  decls: [],
  tags: [],
  documented: true,
});
const api: ApiModel = {
  entries: new Map([
    [
      'pkg',
      [
        x('make', 'function'),
        x('Opts', 'type'),
        x('Deep', 'interface'),
        x('Other', 'type'),
        x('helper', 'function'),
      ],
    ],
    ['pkg/re', [{ ...x('Opts', 'type'), home: 'pkg' }]],
  ]),
  refs: new Map([
    ['k:make', ['k:Opts', 'k:helper']],
    ['k:Opts', ['k:Deep']],
  ]),
};
const map = (o: Partial<DocsMap> = {}): DocsMap => ({
  guides: { g: { paths: ['packages/pkg/src/'], exports: { pkg: ['make'] } } },
  referenceOnly: {},
  ...o,
});

const cov = (m: DocsMap, base?: DocsMap): string[] => messages(checkCoverage(m, api, base));

describe('item 6: coverage', () => {
  it('fails an export nothing covers, and covers types reached from a covered export', () => {
    expect(cov(map())).toEqual([
      "pkg `Other` is in no guide's exports or referenceOnly, and no covered export reaches it",
      "pkg `helper` is in no guide's exports or referenceOnly, and no covered export reaches it",
    ]);
  });

  it('passes once the rest is in referenceOnly or pending', () => {
    expect(
      cov(map({ referenceOnly: { pkg: ['helper'] }, pending: { '13': { pkg: ['Other'] } } })),
    ).toEqual([]);
  });

  it('counts a re-export as its declaration', () => {
    expect(
      cov(
        map({
          guides: {
            g: { paths: [], exports: { 'pkg/re': ['Opts'], pkg: ['make', 'helper', 'Other'] } },
          },
        }),
      ),
    ).toEqual([]);
  });

  it('fails a stale name', () => {
    expect(cov(map({ referenceOnly: { pkg: ['helper', 'Other', 'gone'] } }))).toEqual([
      "referenceOnly: pkg doesn't export `gone` (remove or rename it)",
    ]);
  });

  it('fails a name that is pending and mapped, or pending and already reached', () => {
    expect(
      cov(
        map({
          referenceOnly: { pkg: ['helper', 'Other'] },
          pending: { '15': { pkg: ['helper', 'Deep'] } },
        }),
      ),
    ).toEqual([
      'pending.15: `helper` is also in referenceOnly; take it out of pending',
      'pending.15: `Deep` is already reached from a covered export; take it out of pending',
    ]);
  });

  it('fails a pending group that is neither a task nor "freeze"', () => {
    expect(
      cov(map({ referenceOnly: { pkg: ['helper'] }, pending: { later: { pkg: ['Other'] } } })),
    ).toEqual(['pending: the group "later" is a task number or "freeze"']);
  });

  it('lets pending only shrink, once the base branch has it', () => {
    const now = map({ pending: { '13': { pkg: ['Other'] }, freeze: { pkg: ['helper'] } } });
    expect(cov(now, map())).toEqual([]);
    expect(cov(now, map({ pending: { '13': { pkg: ['Other'] } } }))).toEqual([
      "pending.freeze: `helper` (pkg) isn't pending on the base branch; pending only shrinks, so map it instead",
    ]);
  });
});

describe('the map notice', () => {
  it('names a guide whose mapped path changed without it', () => {
    expect(mapNotices(map(), ['packages/pkg/src/a.ts'])).toEqual([
      {
        file: 'docs/guide/g.md',
        message: 'packages/pkg/src/a.ts changed; does "g" need a change too?',
      },
    ]);
    expect(mapNotices(map(), ['packages/pkg/src/a.ts', 'docs/guide/g.md'])).toEqual([]);
    expect(mapNotices(map(), ['packages/other/a.ts'])).toEqual([]);
  });
});
