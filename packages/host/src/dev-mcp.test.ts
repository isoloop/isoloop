// The dev MCP's page side (ADR 0018, decision 8): `connectDevMCP` against a
// real kernel and bus worker, with a fake WebSocket standing in for the
// `isoloop mcp` CLI (the CLI's own tests run its real server).
import type { CliToPage, PageToCli } from '@isoloop/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import list, { act, ask, told } from './__fixtures__/agents-contracts';
import { connectDevMCP } from './dev-mcp';
import { createKernel, type Kernel } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const contractsUrl = new URL('./__fixtures__/agents-contracts.ts', import.meta.url).href;
const src = new URL('./__fixtures__/throws.ts', import.meta.url).href;

/** A WebSocket the test plays the CLI's side of. */
class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  readonly sent: PageToCli[] = [];
  closedWith: number | undefined;

  constructor(readonly url: string) {
    super();
    FakeSocket.all.push(this);
  }

  send(text: string): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the page sends the wire
    this.sent.push(JSON.parse(text) as PageToCli);
  }

  close(code = 1000): void {
    this.closedWith = code;
    this.end(code, '');
  }

  // The CLI's side.
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(m: CliToPage): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(m) }));
  }

  end(code: number, reason: string): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new CloseEvent('close', { code, reason }));
  }

  results(): Extract<PageToCli, { t: 'result' }>[] {
    return this.sent.filter((m): m is Extract<PageToCli, { t: 'result' }> => m.t === 'result');
  }
}

const kernels: Kernel[] = [];
const disconnects: (() => void)[] = [];
const real = globalThis.WebSocket;
beforeEach(() => {
  FakeSocket.all = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the test
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
afterEach(async () => {
  for (const d of disconnects.splice(0)) d();
  globalThis.WebSocket = real;
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function setup(mode = 'echo'): Kernel {
  const kernel = createKernel({
    contracts: { url: contractsUrl, list },
    workers: {
      isolateBootstrap: worker('./__fixtures__/responder-bootstrap.ts'),
      bus: worker('../../bus/src/worker.ts'),
    },
    agents: { expose: ['agents.*'], timeoutMs: 2_000 },
  });
  kernels.push(kernel);
  kernel.spawn({
    id: 'R',
    src,
    grants: { publish: [], subscribe: [ask.name, act.name] },
    config: { topics: [ask.name, act.name], mode },
  });
  return kernel;
}

function connect(kernel: Parameters<typeof connectDevMCP>[0], url?: string): FakeSocket {
  disconnects.push(
    connectDevMCP(kernel, { token: 'tok', title: 'Test page', ...(url ? { url } : {}) }),
  );
  const s = FakeSocket.all.at(-1);
  if (s === undefined) throw new Error('no socket');
  return s;
}

const until = async (check: () => boolean, ms = 5_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    // oxlint-disable-next-line no-await-in-loop -- polling on purpose
    await new Promise((r) => setTimeout(r, 10));
  }
};

const call = (id: string, name: string, input: unknown): CliToPage => ({
  v: 1,
  t: 'call',
  id,
  p: { name, input },
});

describe('connectDevMCP', () => {
  it("dials the CLI's default URL and says hello with the token, the page and its tools", () => {
    const s = connect(setup());
    expect(s.url).toBe('ws://127.0.0.1:4317');
    s.open();
    const [hello] = s.sent;
    expect(hello?.t).toBe('hello');
    if (hello?.t !== 'hello') return;
    expect(hello.p.token).toBe('tok');
    expect(hello.p.url).toBe(location.href);
    expect(hello.p.title).toBe('Test page');
    expect(hello.p.tools.map((t) => t.name)).toEqual([ask.name, act.name]);
    expect(hello.p.tools[0]).toMatchObject({
      title: 'Ask',
      readOnly: true,
      consequential: false,
      timeoutMs: 2_000,
      inputSchema: { type: 'object' },
    });
    expect(hello.p.tools[0]).not.toHaveProperty('topic');
  });

  it("answers a call with kernel.request's reply, made with via: 'mcp'", async () => {
    const s = connect(setup());
    s.open();
    s.receive({ v: 1, t: 'welcome', p: { page: 'p1' } });
    s.receive(call('c1', ask.name, { q: 'hi' }));
    await until(() => s.results().length === 1);
    const [r] = s.results();
    expect(r?.re).toBe('c1');
    expect(r?.p.ok).toBe(true);
    expect(r?.p).toMatchObject({
      ok: true,
      value: { echo: { q: 'hi' }, from: 'host', via: 'mcp', by: 'R' },
    });
  });

  it("sends a failed request's BusError code and message, and unknown_tool for a name it doesn't expose", async () => {
    const s = connect(setup());
    s.open();
    s.receive(call('c1', ask.name, { nope: 1 }));
    s.receive(call('c2', 'other.untooled.v1', { q: '' }));
    await until(() => s.results().length === 2);
    const byId = new Map(s.results().map((r) => [r.re, r.p]));
    expect(byId.get('c1')).toMatchObject({ ok: false, code: 'invalid' });
    expect(byId.get('c2')).toMatchObject({ ok: false, code: 'unknown_tool' });
  });

  it("passes the tool's timeout: a silent responder fails the call with timeout", async () => {
    const s = connect(setup('silent'));
    s.open();
    s.receive(call('c1', ask.name, { q: 'hi' }));
    await until(() => s.results().length === 1, 6_000);
    expect(s.results()[0]?.p).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('aborts the request on cancel, and answers nothing', async () => {
    const request = vi.fn((_t: unknown, _v: unknown, o?: { signal?: AbortSignal }) => {
      return new Promise<never>((_resolve, reject) => {
        o?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const kernel = setup();
    const s = connect({ tools: () => kernel.tools(), request });
    s.open();
    s.receive(call('c1', ask.name, { q: 'hi' }));
    const signal = request.mock.calls[0]?.[2]?.signal;
    expect(request.mock.calls[0]?.[2]).toMatchObject({ timeoutMs: 2_000, via: 'mcp' });
    expect(signal?.aborted).toBe(false);
    s.receive({ v: 1, t: 'cancel', re: 'c1', p: {} });
    expect(signal?.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(s.results()).toEqual([]);
  });

  it('reconnects after the CLI goes away, backing off, and stops on a wrong token', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = connect(
      { tools: () => [], request: () => new Promise(() => {}) },
      'ws://127.0.0.1:9',
    );
    first.end(1006, '');
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]?.end(1006, '');
    vi.advanceTimersByTime(1_999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]?.open();
    FakeSocket.all[2]?.end(4401, 'wrong token');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('refused this page (wrong token)'));
  });

  it('the returned function closes the socket, aborts calls in flight and stops retrying', () => {
    const kernel = setup();
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const stop = connectDevMCP(
      {
        tools: () => kernel.tools(),
        request: (_t, _v, o) => {
          signal = o?.signal;
          return new Promise(() => {});
        },
      },
      { token: 'tok' },
    );
    const s = FakeSocket.all[0];
    s?.open();
    s?.receive(call('c1', ask.name, { q: 'hi' }));
    stop();
    expect(s?.closedWith).toBe(1000);
    expect(signal?.aborted).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

const op = (id: string, p: Extract<CliToPage, { t: 'op' }>['p']): CliToPage => ({
  v: 1,
  t: 'op',
  id,
  p,
});
const resultOf = (s: FakeSocket, id: string) => s.results().find((r) => r.re === id)?.p;
const helloOf = (s: FakeSocket) => s.sent.find((m) => m.t === 'hello');

describe("connectDevMCP: the dev MCP's own tools (M4a task 8)", () => {
  it('says it inspects only when the kernel has inspect()', () => {
    const kernel = setup();
    const full = connect(kernel);
    full.open();
    const narrow = connect({
      tools: () => kernel.tools(),
      request: (...a) => kernel.request(...a),
    });
    narrow.open();
    expect(helloOf(full)?.p).toMatchObject({ inspect: true });
    expect(helloOf(narrow)?.p).toMatchObject({ inspect: false });
  });

  it('answers the reads from kernel.inspect(), with ages instead of page timestamps', async () => {
    const kernel = setup();
    await until(() => kernel.isolates().some((i) => i.id === 'R' && i.state === 'running'));
    const s = connect(kernel);
    s.open();
    s.receive(call('c1', ask.name, { q: 'hi' }));
    await until(() => s.results().length === 1);
    s.receive(op('o1', { op: 'isolates' }));
    s.receive(op('o2', { op: 'records', topic: ask.name, last: 5 }));
    s.receive(op('o3', { op: 'events', last: 200 }));
    s.receive(op('o4', { op: 'topics' }));
    await until(() => s.results().length === 5);
    const isolates = resultOf(s, 'o1');
    expect(isolates).toMatchObject({
      ok: true,
      value: { isolates: [{ id: 'R', state: 'running' }], pools: [] },
    });
    expect(JSON.stringify(isolates)).not.toContain('lastBeatAt');
    const records = resultOf(s, 'o2');
    expect(records?.ok && records.value).toMatchObject({
      records: [{ topic: ask.name, req: { from: 'host', via: 'mcp' } }],
    });
    const events = resultOf(s, 'o3');
    const seen = events?.ok
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the expect below checks the shape
        (events.value as { events: { event: string; agoMs: number }[] }).events
      : [];
    expect(seen.some((e) => e.event === 'isolate:state' && e.agoMs >= 0)).toBe(true);
    expect(resultOf(s, 'o4')).toMatchObject({ ok: true, value: { bus: { restarts: 0 } } });
  });

  it("does the writes: publish, request with via 'mcp', restart; errors keep their codes", async () => {
    const kernel = setup();
    await until(() => kernel.isolates().some((i) => i.id === 'R' && i.state === 'running'));
    const s = connect(kernel);
    s.open();
    s.receive(op('w1', { op: 'publish', topic: told.name, value: 7 }));
    s.receive(op('w2', { op: 'publish', topic: told.name, value: 'seven' }));
    s.receive(op('w3', { op: 'request', topic: ask.name, value: { q: 'x' }, timeoutMs: 2_000 }));
    s.receive(op('w4', { op: 'restart', id: 'nobody' }));
    await until(() => s.results().length === 4);
    expect(resultOf(s, 'w1')).toEqual({ ok: true, value: { ok: true } });
    expect(resultOf(s, 'w2')).toMatchObject({ ok: false, code: 'invalid' });
    expect(resultOf(s, 'w3')).toMatchObject({
      ok: true,
      value: { reply: { echo: { q: 'x' }, via: 'mcp' } },
    });
    // An unknown id is a plain Error in the kernel: code `error`, with the id.
    expect(resultOf(s, 'w4')).toMatchObject({ ok: false, code: 'error' });
    expect(JSON.stringify(resultOf(s, 'w4'))).toContain('nobody');
    const states: string[] = [];
    kernel.on('isolate:state', (e) => {
      if (e.id === 'R') states.push(e.state);
    });
    s.receive(op('w5', { op: 'restart', id: 'R' }));
    await until(() => s.results().length === 5);
    expect(resultOf(s, 'w5')).toEqual({ ok: true, value: { ok: true } });
    await until(() => states.includes('running'));
  });

  it('taps live records for ms, with what the cap skipped, and stops early at max', async () => {
    const kernel = setup();
    await until(() => kernel.isolates().some((i) => i.id === 'R' && i.state === 'running'));
    const s = connect(kernel);
    s.open();
    s.receive(op('t1', { op: 'tap', topics: [told.name], ms: 2_500, max: 100 }));
    s.receive(op('t2', { op: 'tap', topics: [told.name], ms: 5_000, max: 3 }));
    // Let both taps open on the bus before publishing.
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 200; i++) void kernel.publish(told, i);
    await until(() => s.results().length === 2, 8_000);
    const wide = resultOf(s, 't1');
    const v = wide?.ok
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the expects check the shape
        (wide.value as { records: { topic: string }[]; skipped: number; ms: number })
      : undefined;
    expect(v?.records.length).toBeGreaterThan(0);
    expect(v?.records.length).toBeLessThanOrEqual(100);
    expect(v?.records.every((r) => r.topic === told.name)).toBe(true);
    // 200 records at once against 50 a second: the bus reports what it left out.
    expect(v?.skipped).toBeGreaterThan(0);
    expect(v?.ms).toBeGreaterThanOrEqual(2_400);
    const narrow = resultOf(s, 't2');
    expect(narrow?.ok && narrow.value).toMatchObject({ records: [{}, {}, {}] });
    // Stopped at max, well before its 5 s.
    expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked above
      narrow?.ok ? (narrow.value as { ms: number }).ms : Infinity,
    ).toBeLessThan(5_000);
  }, 15_000);

  it('ends a cancelled tap without answering it', async () => {
    const kernel = setup();
    await until(() => kernel.isolates().some((i) => i.id === 'R' && i.state === 'running'));
    const s = connect(kernel);
    s.open();
    s.receive(op('t1', { op: 'tap', topics: [told.name], ms: 10_000, max: 100 }));
    await new Promise((r) => setTimeout(r, 100));
    s.receive({ v: 1, t: 'cancel', re: 't1', p: {} });
    s.receive(op('t2', { op: 'tap', topics: [told.name], ms: 50, max: 100 }));
    await until(() => s.results().length === 1);
    expect(resultOf(s, 't1')).toBeUndefined();
    expect(resultOf(s, 't2')).toMatchObject({ ok: true, value: { records: [], skipped: 0 } });
  });

  it('answers unsupported to an op from a kernel without inspect()', async () => {
    const kernel = setup();
    const s = connect({ tools: () => kernel.tools(), request: (...a) => kernel.request(...a) });
    s.open();
    s.receive(op('o1', { op: 'isolates' }));
    await until(() => s.results().length === 1);
    expect(resultOf(s, 'o1')).toMatchObject({ ok: false, code: 'unsupported' });
  });
});
