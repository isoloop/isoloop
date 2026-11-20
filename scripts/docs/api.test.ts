// The API reference generator (M4c, decisions 27–29), on a fixture `.d.ts`.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  anchor,
  GENERATED,
  ordered,
  parseDoc,
  renderCli,
  renderExport,
  renderPage,
  signature,
} from './api.ts';
import { readApi, type ApiExport, type ApiModel } from './read-api.ts';

const dir = join(import.meta.dirname, '__fixtures__/reference');
let api: ApiModel;
const get = (entry: string, name: string): ApiExport => {
  const x = api.entries.get(entry)?.find((e) => e.name === name);
  if (!x) throw new Error(`${entry} ${name} missing`);
  return x;
};
const ctx = {
  page: 'main.md',
  pageOf: (entry: string): string => `${entry}.md`,
  guides: (_entry: string, name: string): string[] =>
    name === 'start' ? ['[Widgets](../guide/widgets.md)'] : [],
};

beforeAll(() => {
  api = readApi(
    [
      { entry: 'main', file: join(dir, 'main/index.d.ts') },
      { entry: 'extra', file: join(dir, 'extra/index.d.ts') },
    ],
    dir,
  );
}, 30_000);

describe('parseDoc', () => {
  it('reads the description, params, returns, throws and examples, and drops @see', () => {
    const d = parseDoc(get('main', 'start').decls[0]?.doc ?? '');
    expect(d.text).toBe(
      'Starts a widget.\n\nIt runs until `stop` is called. See `Widget` and the options.',
    );
    expect(d.params).toEqual([
      { name: 'name', text: "The widget's name." },
      { name: 'o', text: 'Its options.' },
    ]);
    expect(d.returns).toBe('The widget, running.');
    expect(d.throws).toEqual(['`bad_name` when `name` is empty.']);
    expect(d.examples).toEqual(["```ts\nconst w = start('a');\n```"]);
    expect(JSON.stringify(d)).not.toContain('guide that the map links');
  });

  it('reads @experimental written inline, and @default', () => {
    expect(parseDoc('/** Stops a widget. @experimental */')).toMatchObject({
      text: 'Stops a widget.',
      experimental: '',
    });
    expect(parseDoc('/**\n * How fast.\n * @default 60\n */').defaultValue).toBe('60');
  });

  it('leaves a tag-like line inside a code fence alone', () => {
    const d = parseDoc('/**\n * Text.\n * ```ts\n * @decorator()\n * ```\n */');
    expect(d.text).toContain('@decorator()');
  });
});

describe('the page', () => {
  it('orders functions, classes, constants, then types, each alphabetical', () => {
    expect(ordered(api.entries.get('main') ?? []).map((e) => e.name)).toEqual([
      'start',
      'stop',
      'Widget',
      'MAX',
      'Options',
    ]);
  });

  it('shows the declaration without export, declare, doc comments or @internal members', () => {
    const opts = get('main', 'Options').decls[0];
    expect(opts && signature(opts)).toBe(
      'type Options = {\n  rate?: number;\n  target?: string;\n  bare: boolean;\n};',
    );
    const start = get('main', 'start').decls[0];
    expect(start && signature(start)).toBe('function start(name: string, o?: Options): Widget;');
  });

  it('renders a function: signature, parameters, returns, throws, example, guides', () => {
    const md = renderExport(get('main', 'start'), 'main', ctx);
    expect(md).toContain('### `start`');
    expect(md).toContain('```ts nocheck\nfunction start(name: string, o?: Options): Widget;\n```');
    expect(md).toContain("| `name` | The widget's name. |");
    expect(md).toContain('**Returns:** The widget, running.');
    expect(md).toContain('**Throws:**\n- `bad_name` when `name` is empty.');
    expect(md).toContain("**Example:**\n\n```ts\nconst w = start('a');\n```");
    expect(md).toContain('**Guides:** [Widgets](../guide/widgets.md).');
  });

  it('marks experimental exports and members, and lists only documented, public members', () => {
    expect(renderExport(get('main', 'stop'), 'main', ctx)).toContain('**Experimental.**');
    const opts = renderExport(get('main', 'Options'), 'main', ctx);
    expect(opts).toContain('| `rate?` | How fast it ticks. Default: 60. |');
    expect(opts).toContain('| `target?` | **Experimental.** Where it draws. |');
    expect(opts).not.toContain('`hook');
    expect(opts).not.toContain('`bare`');
    const widget = renderExport(get('main', 'Widget'), 'main', ctx);
    expect(widget).toContain('| Member | Description |');
    expect(widget).toContain('| `pause()` | Pauses it. |');
    expect(widget).not.toContain('secret`');
  });

  it("links a re-export to its home page's anchor", () => {
    expect(renderExport(get('extra', 'Widget'), 'extra', { ...ctx, page: 'extra.md' })).toBe(
      '### `Widget`\n\nRe-exported from `main`: see [`Widget`](main.md#widget).',
    );
  });

  it('starts with the title and the lead, has a section per entry point, and ends with the notice', () => {
    const md = renderPage(
      '@isoloop/x',
      'The lead.',
      [
        { entry: 'main', exports: api.entries.get('main') ?? [] },
        { entry: 'extra', exports: api.entries.get('extra') ?? [] },
      ],
      ctx,
    );
    expect(md.startsWith('# @isoloop/x\n\nThe lead.\n\n## `main`\n\n### `start`')).toBe(true);
    expect(md).toContain('## `extra`');
    expect(md.trimEnd().endsWith(GENERATED)).toBe(true);
  });

  it("makes GitHub's anchors", () => {
    expect(anchor('`KernelConfig`')).toBe('kernelconfig');
    expect(anchor('`@isoloop/host/dev-mcp`')).toBe('isoloophostdev-mcp');
  });
});

describe('the CLI page', () => {
  it('lists every command with its usage, help and flags', () => {
    const md = renderCli([
      {
        path: ['contracts', 'export'],
        summary: 'Write JSON Schema',
        usage: '<module>',
        details: '<module> is the module.\nIt prints JSON.\n\nSecond paragraph.',
        flags: {
          out: { type: 'string', short: 'o', value: 'file', description: 'Write to a file' },
          help: { type: 'boolean', short: 'h', description: 'Show this help' },
        },
      },
    ]);
    expect(md).toContain('## `isoloop contracts export`\n\nWrite JSON Schema.');
    expect(md).toContain('```sh\nisoloop contracts export <module> [options]\n```');
    expect(md).toContain('\\<module> is the module. It prints JSON.\n\nSecond paragraph.');
    expect(md).toContain('| `-o, --out <file>` | Write to a file. |');
    expect(md).toContain('| `-h, --help` | Show this help. |');
  });
});
