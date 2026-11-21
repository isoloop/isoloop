// Tools for agents (ADR 0018): `agents.expose`, the start check,
// `kernel.tools()` and `kernel.request` against the real bus worker.
import { routeTopic } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { act, ask, nojson, told, untooled } from '../__fixtures__/agents-contracts';
import {
  BusError,
  createKernel,
  KernelError,
  type Kernel,
  type KernelConfig,
  type KernelEvents,
} from '../index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const busWorker = worker('../../../bus/src/worker.ts');
const bootstrap = worker('../__fixtures__/responder-bootstrap.ts');
const contractsUrl = new URL('../__fixtures__/agents-contracts.ts', import.meta.url).href;
const src = new URL('../__fixtures__/throws.ts', import.meta.url).href; // never imported by the test bootstrap

const kernels: Kernel[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function setup(extra: Partial<KernelConfig> = {}): Kernel {
  const kernel = createKernel({
    contracts: { url: contractsUrl, list },
    workers: { isolateBootstrap: bootstrap, bus: busWorker },
    supervisor: { backoff: { initialMs: 50 } },
    agents: { expose: ['agents.*'] },
    ...extra,
  });
  kernels.push(kernel);
  return kernel;
}

/** A responder isolate on `topics`, answering as `mode` says (see the bootstrap). */
function responder(kernel: Kernel, id: string, mode = 'echo', topics = [ask.name, act.name]) {
  return kernel.spawn({
    id,
    src,
    grants: { publish: [], subscribe: topics },
    config: { topics, mode },
  });
}

const rejection = async (p: Promise<unknown>): Promise<BusError> => {
  const e: unknown = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  if (!(e instanceof BusError)) throw new Error(`expected a BusError, got ${String(e)}`);
  return e;
};

const startError = (cfg: Partial<KernelConfig>): KernelError => {
  try {
    setup(cfg);
  } catch (e) {
    if (e instanceof KernelError) return e;
    throw e;
  }
  throw new Error('createKernel did not throw');
};

describe('agents.expose and kernel.tools()', () => {
  it('lists each exposed tool with its flags, JSON Schemas and timeout', () => {
    const kernel = setup();
    const tools = kernel.tools();
    expect(tools.map((t) => t.name)).toEqual(['agents.ask.v1', 'agents.act.v1']);
    const [a, b] = tools;
    expect(a).toMatchObject({
      name: 'agents.ask.v1',
      title: 'Ask',
      description: 'Echoes the question',
      readOnly: true,
      consequential: false,
      untrustedContent: false,
      inputSchema: { type: 'object', in: true },
      outputSchema: { type: 'object', title: 'answer', out: true },
      timeoutMs: 10_000,
    });
    expect(a?.topic).toBe(ask);
    expect(b).toMatchObject({ readOnly: false, consequential: true, untrustedContent: true });
    expect(b && 'title' in b).toBe(false);
  });

  it('is empty without agents, and takes agents.timeoutMs', () => {
    const bare = createKernel({
      contracts: { url: contractsUrl, list },
      workers: { isolateBootstrap: bootstrap, bus: busWorker },
    });
    kernels.push(bare);
    expect(bare.tools()).toEqual([]);
    expect(setup({ agents: { expose: [ask.name], timeoutMs: 2500 } }).tools()[0]?.timeoutMs).toBe(
      2500,
    );
  });

  it.each([
    ['no reply', told.name, /other\.told\.v1: has no reply schema/],
    ['no tool', untooled.name, /other\.untooled\.v1: has no `tool`/],
    [
      'no JSON Schema',
      nojson.name,
      /other\.nojson\.v1: schema doesn't implement Standard JSON Schema/,
    ],
  ])('fails the start with not_exposable for a topic with %s', (_, pattern, message) => {
    const e = startError({ agents: { expose: ['agents.*', pattern] } });
    expect(e.code).toBe('not_exposable');
    expect(e.message).toMatch(message);
  });

  it('rejects a malformed agents config with invalid_config', () => {
    expect(startError({ agents: { expose: ['agents.*'], timeoutMs: 0 } }).code).toBe(
      'invalid_config',
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a config from untyped code
    expect(startError({ agents: { expose: 'agents.*' as unknown as string[] } }).code).toBe(
      'invalid_config',
    );
  });

  it('warns once through agents:unmatched for a pattern that matches nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kernel = setup({ agents: { expose: ['agents.*', 'nothing.*', 'nope.v1'] } });
    const got: KernelEvents['agents:unmatched'][] = [];
    kernel.on('agents:unmatched', (e) => got.push(e));
    await Promise.resolve();
    expect(got).toEqual([{ patterns: ['nothing.*', 'nope.v1'] }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(kernel.tools()).toHaveLength(2);
  });
});

describe('kernel.request', () => {
  it('resolves with the reply; the record carries from: host, the request id and via', async () => {
    const kernel = setup();
    responder(kernel, 'R', 'echo', [ask.name, untooled.name]);
    const r = await kernel.request(ask, { q: 'hi' }, { via: 'webmcp', timeoutMs: 5000 });
    expect(r).toMatchObject({ echo: { q: 'hi' }, from: 'host', via: 'webmcp', by: 'R' });
    expect(typeof r.id).toBe('string');
    // Without via, and on a requestable topic no pattern exposes: exposure only decides listing.
    const plain = await kernel.request(untooled, { q: 'x' });
    expect(plain).toMatchObject({ via: null, from: 'host' });
  });

  it('fails at once with no_responder when no isolate could answer', async () => {
    const kernel = setup();
    const t0 = performance.now();
    expect((await rejection(kernel.request(ask, { q: 'a' }))).code).toBe('no_responder');
    // An isolate without a subscribe grant for the topic doesn't count.
    responder(kernel, 'other', 'echo', ['other.untooled.v1']);
    expect((await rejection(kernel.request(ask, { q: 'b' }))).code).toBe('no_responder');
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('fails at once with no_responder when every responder has failed', async () => {
    const kernel = setup({ supervisor: { strategy: 'never' } });
    const failed = new Promise<void>((resolve) => kernel.on('isolate:failed', () => resolve()));
    responder(kernel, 'D', 'die');
    await failed;
    const t0 = performance.now();
    expect((await rejection(kernel.request(ask, { q: 'a' }))).code).toBe('no_responder');
    expect(performance.now() - t0).toBeLessThan(500);
    // Stopped isolates don't count either.
    responder(kernel, 'S');
    await kernel.stop('S');
    expect((await rejection(kernel.request(ask, { q: 'b' }))).code).toBe('no_responder');
  });

  it('times out when nobody replies', async () => {
    const kernel = setup();
    responder(kernel, 'R', 'silent');
    const e = await rejection(kernel.request(ask, { q: 'a' }, { timeoutMs: 200 }));
    expect(e.code).toBe('timeout');
    expect(e.message).toMatch(/agents\.ask\.v1 within 200 ms/);
  });

  it('rejects with aborted when the signal aborts, before or during the call', async () => {
    const kernel = setup();
    responder(kernel, 'R', 'silent');
    const before = new AbortController();
    before.abort();
    const early = await rejection(kernel.request(ask, { q: 'a' }, { signal: before.signal }));
    expect(early.code).toBe('aborted');
    const during = new AbortController();
    const call = kernel.request(ask, { q: 'b' }, { signal: during.signal, timeoutMs: 5000 });
    setTimeout(() => during.abort(), 50);
    const t0 = performance.now();
    expect((await rejection(call)).code).toBe('aborted');
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('still gets the reply when the responder crashes and restarts within the timeout', async () => {
    const kernel = setup();
    const crashes: string[] = [];
    kernel.on('isolate:crash', (e) => crashes.push(e.id));
    responder(kernel, 'C', 'crash-live');
    await new Promise<void>((resolve) => kernel.on('isolate:ready', () => resolve()));
    const r = await kernel.request(ask, { q: 'again' }, { timeoutMs: 8000 });
    expect(r).toMatchObject({ echo: { q: 'again' }, by: 'C' });
    expect(crashes).toEqual(['C']);
  });

  it('times out on a blocked responder while the page and other isolates keep running', async () => {
    const kernel = setup();
    responder(kernel, 'B', 'block', [ask.name]);
    responder(kernel, 'E', 'echo', [act.name]);
    await vi.waitUntil(() => kernel.isolates().every((i) => i.state === 'running'));
    const e = await rejection(kernel.request(ask, { q: 'stuck' }, { timeoutMs: 300 }));
    expect(e.code).toBe('timeout');
    expect(await kernel.request(act, { q: 'fine' })).toMatchObject({ by: 'E' });
  });

  it('rejects isoloop.* topics, unknown topics, unrequestable topics and bad values', async () => {
    const kernel = setup();
    responder(kernel, 'R');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route topic has no reply; the kernel must refuse it anyway
    const route = routeTopic as unknown as typeof ask;
    expect((await rejection(kernel.request(route, { q: '' }))).code).toBe('forbidden');
    const unknown = { ...ask, name: 'agents.missing.v1' };
    expect((await rejection(kernel.request(unknown, { q: '' }))).code).toBe('unknown_topic');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- not requestable on purpose
    const notReq = told as unknown as typeof ask;
    expect((await rejection(kernel.request(notReq, { q: '' }))).code).toBe('not_requestable');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an invalid value on purpose
    const bad = { nope: 1 } as unknown as { q: string };
    expect((await rejection(kernel.request(ask, bad))).code).toBe('invalid');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an unknown via on purpose
    const via = 'carrier-pigeon' as unknown as 'mcp';
    expect((await rejection(kernel.request(ask, { q: '' }, { via }))).code).toBe('invalid');
  });

  it('is typed by the topic: the value is the input, the result the reply', () => {
    const kernel = setup();
    const call = (): Promise<{ echo: unknown }> => kernel.request(ask, { q: 'typed' });
    expect(typeof call).toBe('function');
  });
});
