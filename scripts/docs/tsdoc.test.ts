// docs:check item 7 (M4c, decision 30): the TSDoc rules, on hand-made
// declarations, and readDocs on a fixture `.d.ts`.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readDocs, type DocExport } from './read-api.ts';
import { checkExamples, checkTsdoc, EXAMPLES, exampleCode, historyIn } from './tsdoc.ts';

const fn = (over: Partial<DocExport> = {}): DocExport => ({
  entry: '@isoloop/x',
  name: 'make',
  kind: 'function',
  doc: 'Makes one.',
  tags: [
    { name: 'param', text: 'name - The name.' },
    { name: 'returns', text: 'The thing.' },
  ],
  signatures: [{ params: ['name'], returns: true }],
  members: [],
  ...over,
});
const messages = (docs: DocExport[]): string[] =>
  checkTsdoc(docs)
    .problems.map((p) => p.message)
    .filter((m) => !m.includes('@example'));

describe('item 7: functions, classes and consts', () => {
  it('passes a function with a lead, its @params and @returns', () => {
    expect(messages([fn()])).toEqual([]);
  });

  it('fails a function, class or const without a lead', () => {
    expect(messages([fn({ doc: '' })])).toEqual(['`make` has no lead sentence']);
    expect(messages([fn({ kind: 'class', doc: '', signatures: [], tags: [] })])).toEqual([
      '`make` has no lead sentence',
    ]);
    expect(
      messages([fn({ kind: 'const', name: 'LIMIT', doc: '', signatures: [], tags: [] })]),
    ).toEqual(['`LIMIT` has no lead sentence']);
  });

  it('leaves types without a lead alone (only their fields, below)', () => {
    expect(messages([fn({ kind: 'interface', doc: '', signatures: [], tags: [] })])).toEqual([]);
  });

  it('fails a missing @param, across every overload', () => {
    const over = fn({
      signatures: [
        { params: ['name'], returns: true },
        { params: ['name', 'opts'], returns: true },
      ],
    });
    expect(messages([over])).toEqual(['`make` has no @param for `opts`']);
  });

  it('counts any @param in the place of a destructured parameter', () => {
    const destr = fn({ signatures: [{ params: ['__0'], returns: true }] });
    expect(messages([destr])).toEqual([]);
    expect(
      messages([
        fn({
          tags: [{ name: 'returns', text: '' }],
          signatures: [{ params: ['__0'], returns: true }],
        }),
      ]),
    ).toEqual(['`make` has no @param for `__0`']);
  });

  it('fails a missing @returns only when it returns a value', () => {
    const tags = [{ name: 'param', text: 'name - The name.' }];
    expect(messages([fn({ tags })])).toEqual(['`make` returns a value but has no @returns']);
    expect(messages([fn({ tags, signatures: [{ params: ['name'], returns: false }] })])).toEqual(
      [],
    );
  });

  it('checks a const you call like a function', () => {
    expect(messages([fn({ kind: 'const', tags: [] })])).toEqual([
      '`make` has no @param for `name`',
      '`make` returns a value but has no @returns',
    ]);
  });
});

const opts = (name: string, doc = ''): DocExport =>
  fn({
    name,
    kind: 'interface',
    tags: [],
    signatures: [],
    members: [
      { name: 'count', key: 'a#1', doc: 'How many. Default `1`.', tags: [] },
      { name: 'label', key: 'a#2', doc, tags: [] },
    ],
  });

describe('item 7: options and config fields', () => {
  it('fails a field of an options or config type without its own comment', () => {
    expect(messages([opts('MakeOptions')])).toEqual([
      '`MakeOptions.label` has no comment of its own',
    ]);
    expect(messages([opts('KernelConfig')])).toEqual([
      '`KernelConfig.label` has no comment of its own',
    ]);
    expect(messages([opts('MakeOptions', 'The label.')])).toEqual([]);
  });

  it("leaves other types' fields alone", () => {
    expect(messages([opts('Snapshot')])).toEqual([]);
  });

  it('reports a field shared through extends once', () => {
    expect(messages([opts('MakeOptions'), opts('MoreOptions')])).toEqual([
      '`MakeOptions.label` has no comment of its own',
    ]);
  });
});

describe('item 7: no ADRs or plans', () => {
  it('finds an ADR, a plan, a milestone or a decision number', () => {
    for (const text of [
      'as ADR 0007 says',
      'see ADR-17',
      'docs/plans/m4c.md',
      'since M3h',
      'decision 30',
    ])
      expect(historyIn({ doc: text, tags: [] })).toBeDefined();
    expect(historyIn({ doc: 'Ok.', tags: [{ name: 'remarks', text: '(ADR 0001)' }] })).toBe(
      'ADR 0001',
    );
    for (const text of ['a DOM2 node', 'up to 100 ms', 'the M key', 'decisions are yours'])
      expect(historyIn({ doc: text, tags: [] })).toBeUndefined();
  });

  it('fails the export or the member that names one', () => {
    const x = fn({
      doc: 'Makes one (ADR 0003).',
      members: [{ name: 'size', key: 'k', doc: 'Size, M3i.', tags: [] }],
    });
    expect(messages([x])).toEqual([
      '`make` names "ADR 0003": say how it works, not why it was decided',
      '`make.size` names "M3i": say how it works, not why it was decided',
    ]);
  });
});

describe('item 7: examples', () => {
  it('takes the ts and tsx fences of an @example, or its whole text', () => {
    expect(exampleCode('Use it:\n```ts\nmake();\n```\n```tsx\n<A />\n```')).toEqual([
      { lang: 'ts', code: 'make();' },
      { lang: 'tsx', code: '<A />' },
    ]);
    expect(exampleCode('make();')).toEqual([{ lang: 'ts', code: 'make();' }]);
    expect(exampleCode('```sh\nnpm i\n```')).toEqual([]);
  });

  it('fails a main entry point without an @example, or missing from the types', () => {
    const create = fn({ entry: '@isoloop/host', name: 'createKernel' });
    const { problems, examples } = checkTsdoc([create]);
    expect(problems.map((p) => p.message)).toContain(
      '`@isoloop/host createKernel` has no @example with code',
    );
    expect(problems.map((p) => p.message)).toContain(
      "`@isoloop/host Kernel.request` isn't in the published types, so its @example can't be checked",
    );
    expect(examples).toEqual([]);
    expect(EXAMPLES).toHaveLength(11);
  });

  it("collects the examples, a member's included", () => {
    const kernel = fn({
      entry: '@isoloop/host',
      name: 'Kernel',
      kind: 'interface',
      tags: [],
      signatures: [],
      members: [
        {
          name: 'request',
          key: 'k',
          doc: 'Asks.',
          tags: [{ name: 'example', text: '```ts\nkernel.request();\n```' }],
        },
      ],
    });
    expect(checkTsdoc([kernel]).examples).toEqual([
      { label: '@isoloop/host Kernel.request', lang: 'ts', code: 'kernel.request();' },
    ]);
  });

  it('type-checks each example next to the fence app', () => {
    const root = join(import.meta.dirname, '../..');
    const problems = checkExamples(root, [
      {
        label: '@isoloop/bus topic',
        lang: 'ts',
        code: "import { topic } from '@isoloop/bus';\nconst t = topic;\n",
      },
      { label: '@isoloop/bus contracts', lang: 'ts', code: 'const n: number = "no";' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe('@isoloop/bus');
    expect(problems[0]?.message).toMatch(
      /^`@isoloop\/bus contracts` @example: doesn't type-check: TS2322/,
    );
  }, 120_000);
});

describe('readDocs', () => {
  const dir = join(import.meta.dirname, '__fixtures__/tsdoc');
  let docs: DocExport[];
  const get = (name: string): DocExport => {
    const x = docs.find((d) => d.name === name);
    if (!x) throw new Error(`${name} missing`);
    return x;
  };
  const count = (n: string): string | undefined =>
    get(n).members.find((m) => m.name === 'count')?.key;
  beforeAll(() => {
    docs = readDocs([{ entry: 'fixture', file: join(dir, 'index.d.ts') }], dir);
  }, 30_000);

  it('reads the lead and the tags, and leaves out @internal', () => {
    expect(get('good').doc).toBe('Does a good thing.');
    expect(get('good').tags.map((t) => t.name)).toEqual(['param', 'param', 'returns', 'example']);
    expect(docs.some((d) => d.name === 'hidden')).toBe(false);
  });

  it('reads each signature: parameter names, and whether it returns a value', () => {
    expect(get('good').signatures).toEqual([{ params: ['name', 'opts'], returns: true }]);
    expect(get('over').signatures).toEqual([
      { params: ['a'], returns: false },
      { params: ['a', 'b'], returns: false },
    ]);
    expect(get('destr').signatures).toEqual([{ params: ['__0'], returns: false }]);
    expect(get('twice').signatures).toEqual([{ params: ['x'], returns: true }]);
    expect(get('BARE').signatures).toEqual([]);
  });

  it("reads the members of interfaces and classes, a member's tags included", () => {
    expect(get('GoodOptions').members.map((m) => [m.name, m.doc])).toEqual([
      ['count', 'How many. Default `1`.'],
      ['label', ''],
    ]);
    expect(get('Thing').members.map((m) => m.name)).toEqual(['size']);
    const request = get('Kernel').members.find((m) => m.name === 'request');
    expect(request?.tags.map((t) => t.name)).toEqual(['experimental', 'example']);
  });

  it('gives an inherited field the same key as where it is declared', () => {
    expect(count('MoreOptions')).toBe(count('GoodOptions'));
  });
});
