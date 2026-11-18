import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from './args';
import type { ExportedContracts } from './commands/contracts-export';
import type { Io } from './io';
import { main, version } from './main';

const fixtures = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

/** An in-memory Io: captured streams and files; modules load through Vitest. */
function memoryIo() {
  const files = new Map<string, string>();
  let out = '';
  let err = '';
  const io: Io = {
    stdin: (async function* () {})(),
    env: {},
    out: (t) => void (out += t),
    err: (t) => void (err += t),
    cwd: fixtures,
    writeFile: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    load: (path) => import(/* @vite-ignore */ path),
  };
  return { io, files, out: () => out, err: () => err };
}

const parse = (json: string): ExportedContracts => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test checks the shape below
  return JSON.parse(json) as ExportedContracts;
};

describe('parseArgs', () => {
  const specs = {
    out: { type: 'string', short: 'o', description: '' },
    help: { type: 'boolean', short: 'h', description: '' },
  } as const;

  it('reads positionals, long, inline and short flags, and stops at --', () => {
    expect(parseArgs(['a', '--out', 'f', 'b'], specs)).toEqual({
      positionals: ['a', 'b'],
      flags: { out: 'f' },
    });
    expect(parseArgs(['--out=x=y', '-h'], specs).flags).toEqual({ out: 'x=y', help: true });
    expect(parseArgs(['-o', 'f', '--', '--help'], specs)).toEqual({
      positionals: ['--help'],
      flags: { out: 'f' },
    });
  });

  it('rejects unknown flags, missing values and values on booleans', () => {
    expect(() => parseArgs(['--nope'], specs)).toThrow(UsageError);
    expect(() => parseArgs(['-x'], specs)).toThrow('unknown option -x');
    expect(() => parseArgs(['--out'], specs)).toThrow('--out needs a value');
    expect(() => parseArgs(['--out', '--help'], specs)).toThrow('--out needs a value');
    expect(() => parseArgs(['--help=1'], specs)).toThrow('--help takes no value');
  });
});

describe('isoloop', () => {
  it('prints the version and the help', async () => {
    const v = memoryIo();
    expect(await main(['--version'], v.io)).toBe(0);
    expect(v.out()).toBe(`${version()}\n`);
    expect(version()).toMatch(/^\d+\.\d+\.\d+/);

    const h = memoryIo();
    expect(await main(['--help'], h.io)).toBe(0);
    expect(h.out()).toContain('contracts export');

    const none = memoryIo();
    expect(await main([], none.io)).toBe(2);
    expect(none.err()).toContain('Usage: isoloop <command>');

    const sub = memoryIo();
    expect(await main(['contracts', 'export', '--help'], sub.io)).toBe(0);
    expect(sub.out()).toContain('Usage: isoloop contracts export <module> [options]');
    expect(sub.out()).toContain('-o, --out <file>');
  });

  it('fails an unknown command or a bad command line with exit 2', async () => {
    const u = memoryIo();
    expect(await main(['nope'], u.io)).toBe(2);
    expect(u.err()).toContain('unknown command nope');

    const m = memoryIo();
    expect(await main(['contracts', 'export'], m.io)).toBe(2);
    expect(m.err()).toContain('missing <module>');

    const f = memoryIo();
    expect(await main(['contracts', 'export', 'contracts.ts', '--bad'], f.io)).toBe(2);
    expect(f.err()).toContain('unknown option --bad');
  });
});

describe('isoloop contracts export', () => {
  it('prints JSON Schema for every topic, with the reply and the tool', async () => {
    const t = memoryIo();
    expect(await main(['contracts', 'export', 'contracts.ts'], t.io)).toBe(0);
    const doc = parse(t.out());
    expect(doc.target).toBe('draft-2020-12');
    expect(Object.keys(doc.topics)).toEqual([
      'markets.quote.v1',
      'orders.placed.v1',
      'ping.v1',
      'raw.events.v1',
    ]);

    const quote = doc.topics['markets.quote.v1'];
    expect(quote?.input).toMatchObject({
      type: 'object',
      properties: { symbol: { type: 'string' } },
      required: ['symbol'],
    });
    expect(quote?.input).not.toHaveProperty('additionalProperties');
    expect(quote?.output).toMatchObject({ required: ['symbol'], additionalProperties: false });
    expect(quote?.replyInput).toMatchObject({
      type: 'object',
      properties: { price: { type: 'number' }, change: { type: 'number' } },
    });
    expect(quote?.replyOutput).toMatchObject({ additionalProperties: false });
    expect(quote?.schema).toBeUndefined();
    expect(quote?.reply).toBeUndefined();
    expect(quote?.tool).toEqual({
      title: 'Quote',
      description: 'The latest price for a symbol.',
      readOnly: true,
    });
  });

  it('exports input and output apart when they differ', async () => {
    const t = memoryIo();
    expect(await main(['contracts', 'export', 'contracts.ts'], t.io)).toBe(0);
    const order = parse(t.out()).topics['orders.placed.v1'];
    expect(order?.schema).toBeUndefined();
    expect(order?.input).toMatchObject({ required: ['id'] });
    expect(order?.output).toMatchObject({ required: ['id', 'size'] });
    expect(order?.reply).toBeUndefined();
    expect(order?.tool).toBeUndefined();
  });

  it('exports a schema once when input and output are the same', async () => {
    const t = memoryIo();
    expect(await main(['contracts', 'export', 'contracts.ts'], t.io)).toBe(0);
    const ping = parse(t.out()).topics['ping.v1'];
    expect(ping).toEqual({
      schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' },
      reply: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' },
    });
  });

  it('exports an unchecked topic as {} and flags it with a warning', async () => {
    const t = memoryIo();
    expect(await main(['contracts', 'export', 'contracts.ts'], t.io)).toBe(0);
    expect(parse(t.out()).topics['raw.events.v1']).toEqual({ schema: {}, unchecked: ['schema'] });
    expect(t.err()).toBe(
      'isoloop: warning: raw.events.v1: schema is unchecked(), exported as {}\n',
    );
  });

  it('writes the file with --out, resolved against the working directory', async () => {
    const t = memoryIo();
    expect(
      await main(['contracts', 'export', `${fixtures}contracts.ts`, '-o', 'out.json'], t.io),
    ).toBe(0);
    expect(t.out()).toBe('');
    const written = t.files.get(`${fixtures}out.json`);
    expect(written).toBeDefined();
    expect(Object.keys(parse(written ?? '{}').topics)).toHaveLength(4);
    expect(t.err()).toContain('wrote 4 topics to out.json');
  });

  it('reports every topic that is not exportable, writes nothing and exits 1', async () => {
    const t = memoryIo();
    expect(await main(['contracts', 'export', 'not-exportable.ts', '--out', 'x.json'], t.io)).toBe(
      1,
    );
    expect(t.out()).toBe('');
    expect(t.files.size).toBe(0);
    expect(t.err()).toContain('isoloop: not exportable:');
    expect(t.err()).toContain("bare.v1: schema doesn't implement Standard JSON Schema (hand-made)");
    expect(t.err()).toContain("lookup.v1: reply can't be made into JSON Schema");
    expect(t.err()).not.toContain('ok.v1');
  });

  it('fails a module that does not load or has no contracts', async () => {
    const missing = memoryIo();
    expect(await main(['contracts', 'export', 'missing.ts'], missing.io)).toBe(1);
    expect(missing.err()).toContain("isoloop: can't load missing.ts");

    const none = memoryIo();
    expect(await main(['contracts', 'export', 'no-contracts.ts'], none.io)).toBe(1);
    expect(none.err()).toBe('isoloop: no-contracts.ts has no default export made by contracts()\n');
  });
});
