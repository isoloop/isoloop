/*
 * `isoloop mcp`, run in-process: the official MCP SDK client on its stdio
 * side (conformance), Node's own WebSocket client (undici) as the pages.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ToolListChangedNotificationSchema,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import {
  isCliToPage,
  type CliToPage,
  type DevMcpOp,
  type DevMcpTool,
  type PageToCli,
} from '@isoloop/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { Io } from '../program/io';
import { main } from '../program/main';
import { originMatcher, tokenMatches } from './pairing';
import { UNTRUSTED_SENTENCE } from './server';
import { readMessages } from './stdio';
import { BUILTIN_BY_NAME } from './tools';
import { listenWs } from './websocket';

const TOKEN = 'test-token-0123456789';
const ORIGIN = 'http://localhost:5173';

/** A pushable stdin. */
function pipe() {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  async function* chunks(): AsyncGenerator<string> {
    for (;;) {
      while (queue.length > 0) yield queue.shift() ?? '';
      if (ended) return;
      // oxlint-disable-next-line no-await-in-loop -- waits for the next push
      await new Promise<void>((r) => (wake = r));
      wake = undefined;
    }
  }
  return {
    chunks: chunks(),
    push: (s: string) => {
      queue.push(s);
      wake?.();
    },
    end: () => {
      ended = true;
      wake?.();
    },
  };
}

const until = async (check: () => boolean, ms = 3_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    // oxlint-disable-next-line no-await-in-loop -- polling on purpose
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** `isoloop mcp --port 0 …` in-process, with an SDK client on its stdio. */
async function startMcp(
  flags: string[] = [],
  env: Record<string, string> = { ISOLOOP_MCP_TOKEN: TOKEN },
) {
  const stdin = pipe();
  let err = '';
  const read = new ReadBuffer();
  let transport: Transport | undefined;
  const io: Io = {
    stdin: stdin.chunks,
    env,
    out: (t) => {
      read.append(Buffer.from(t, 'utf8'));
      for (let m = read.readMessage(); m !== null; m = read.readMessage())
        transport?.onmessage?.(m);
    },
    err: (t) => void (err += t),
    cwd: process.cwd(),
    writeFile: () => Promise.resolve(),
    load: () => Promise.reject(new Error('no modules')),
  };
  const exit = main(['mcp', '--port', '0', ...flags], io);
  await until(() => /waiting for pages on ws:\/\/127\.0\.0\.1:\d+/.test(err));
  const port = Number(/127\.0\.0\.1:(\d+)/.exec(err)?.[1]);
  transport = {
    start: () => Promise.resolve(),
    send: (m: JSONRPCMessage) => {
      stdin.push(serializeMessage(m));
      return Promise.resolve();
    },
    close: () => {
      stdin.end();
      return Promise.resolve();
    },
  };
  const client = new Client({ name: 'test', version: '0' });
  let changes = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changes++;
  });
  await client.connect(transport);
  const stop = async (): Promise<number> => {
    await client.close();
    return exit;
  };
  running.push(stop);
  return { client, port, err: () => err, changes: () => changes, stop };
}

/** The listed names without the dev MCP's own inspection tools (`tools.ts`). */
const appTools = (tools: readonly { name: string }[]): string[] =>
  tools.map((t) => t.name).filter((n) => n === 'isoloop_pages' || !BUILTIN_BY_NAME.has(n));

const running: (() => Promise<number>)[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(async (stop) => stop()));
});

const tool = (over: Partial<DevMcpTool> & { name: string }): DevMcpTool => ({
  description: `The ${over.name} tool`,
  readOnly: true,
  consequential: false,
  untrustedContent: false,
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { symbol: { type: 'string' } },
    required: ['symbol'],
  },
  outputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { price: { type: 'number' } },
    required: ['price'],
    additionalProperties: false,
  },
  timeoutMs: 1_000,
  ...over,
});

const TOOLS: DevMcpTool[] = [
  tool({ name: 'markets.quote.v1', title: 'Quote', untrustedContent: true }),
  tool({ name: 'markets.alerts.create.v1', readOnly: false, consequential: true }),
  tool({
    name: 'echo.v1',
    inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' },
    outputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' },
  }),
];

type Answer = (call: { name: string; input: unknown }) => PageToCli['p'] | 'never';

/** A fake page: connects, says hello, answers calls with `answer`. */
async function page(
  port: number,
  o: {
    token?: string;
    origin?: string | null;
    tools?: DevMcpTool[];
    answer?: Answer;
    url?: string;
    /** Says `inspect` in its hello, and answers ops with this. */
    op?: (op: DevMcpOp) => PageToCli['p'];
  } = {},
) {
  const headers: Record<string, string> = {};
  if (o.origin !== null) headers['origin'] = o.origin ?? ORIGIN;
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
  const received: CliToPage[] = [];
  let closeCode: number | undefined;
  let failed = false;
  ws.addEventListener('message', (e) => {
    const m: unknown = JSON.parse(String(e.data));
    if (!isCliToPage(m)) throw new Error(`not a CLI message: ${String(e.data)}`);
    received.push(m);
    if (m.t === 'call' && o.answer !== undefined) {
      const a = o.answer(m.p);
      if (a !== 'never') ws.send(JSON.stringify({ v: 1, t: 'result', re: m.id, p: a }));
    }
    if (m.t === 'op' && o.op !== undefined) {
      ws.send(JSON.stringify({ v: 1, t: 'result', re: m.id, p: o.op(m.p) }));
    }
  });
  ws.addEventListener('close', (e) => (closeCode = e.code));
  ws.addEventListener('error', () => (failed = true));
  await until(() => ws.readyState !== WebSocket.CONNECTING);
  if (ws.readyState === WebSocket.OPEN) {
    const hello: PageToCli = {
      v: 1,
      t: 'hello',
      p: {
        token: o.token ?? TOKEN,
        url: o.url ?? 'http://localhost:5173/',
        title: 'Markets',
        tools: o.tools ?? TOOLS,
        ...(o.op === undefined ? {} : { inspect: true }),
      },
    };
    ws.send(JSON.stringify(hello));
  }
  return {
    ws,
    received,
    closeCode: () => closeCode,
    failed: () => failed,
    welcomed: async () => {
      await until(() => received.some((m) => m.t === 'welcome'));
      const w = received.find((m) => m.t === 'welcome');
      return w?.t === 'welcome' ? w.p.page : '';
    },
  };
}

const priced: Answer = ({ input }) => ({
  ok: true,
  value: { price: typeof input === 'object' && input !== null && 'symbol' in input ? 42 : -1 },
});

describe('pairing', () => {
  it('matches origins with * as any run but /', () => {
    const m = originMatcher('http://localhost:*');
    expect(m('http://localhost:5173')).toBe(true);
    expect(m('http://localhost:80')).toBe(true);
    expect(m('http://localhost')).toBe(false);
    expect(m('http://localhost.evil.com')).toBe(false);
    expect(m('https://localhost:5173')).toBe(false);
    expect(m('http://localhost:1/x')).toBe(false);
    expect(m(undefined)).toBe(false);
    const several = originMatcher('http://localhost:*, https://app.test');
    expect(several('https://app.test')).toBe(true);
    expect(several('https://app.test.evil')).toBe(false);
  });

  it('compares tokens exactly', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abc', 'abd')).toBe(false);
    expect(tokenMatches('abc', 'abcd')).toBe(false);
    expect(tokenMatches('abc', undefined)).toBe(false);
  });
});

async function* split(): AsyncGenerator<string | Uint8Array> {
  yield '{"a":';
  yield new TextEncoder().encode('1}\n\n{"b":"é\\n"}\nnot json\n{"c"');
  yield ':3}';
}

describe('stdio framing', () => {
  it('reads one message per line across chunk boundaries', async () => {
    const got: unknown[] = [];
    let bad = 0;
    await readMessages(
      split(),
      (m) => got.push(m),
      () => bad++,
    );
    expect(got).toEqual([{ a: 1 }, { b: 'é\n' }, { c: 3 }]);
    expect(bad).toBe(1);
  });
});

describe('websocket server', () => {
  it("speaks to Node's WebSocket client: text both ways, big and fragmented-size messages, close codes", async () => {
    const server = await listenWs({
      host: '127.0.0.1',
      port: 0,
      accept: () => true,
      onConnection: (c) => {
        c.onMessage = (text) => (text === 'bye' ? c.close(4401, 'nope') : c.send(text));
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: string[] = [];
    let code: number | undefined;
    ws.addEventListener('message', (e) => got.push(String(e.data)));
    ws.addEventListener('close', (e) => (code = e.code));
    await until(() => ws.readyState === WebSocket.OPEN);
    const big = 'x'.repeat(70_000);
    const mid = 'ü'.repeat(200);
    ws.send('hello');
    ws.send(mid);
    ws.send(big);
    await until(() => got.length === 3);
    expect(got).toEqual(['hello', mid, big]);
    ws.send('bye');
    await until(() => code !== undefined);
    expect(code).toBe(4401);
    await server.close();
  });

  it('refuses a request the accept hook rejects, with its status', async () => {
    const server = await listenWs({
      host: '127.0.0.1',
      port: 0,
      accept: () => 403,
      onConnection: () => {},
    });
    const res = await fetch(`http://127.0.0.1:${server.port}`, {
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    }).catch(() => undefined);
    // fetch may refuse the upgrade itself; either way no WebSocket opens.
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    let failed = false;
    ws.addEventListener('error', () => (failed = true));
    await until(() => failed);
    expect(res?.status ?? 403).not.toBe(101);
    await server.close();
  });
});

describe('isoloop mcp', () => {
  it('initializes with the SDK client and lists only isoloop_pages before a page connects', async () => {
    const { client } = await startMcp();
    expect(client.getServerVersion()?.name).toBe('isoloop');
    expect(client.getServerCapabilities()?.tools).toEqual({ listChanged: true });
    const { tools } = await client.listTools();
    expect(appTools(tools)).toEqual(['isoloop_pages']);
  });

  it('prints a fresh token on stderr unless ISOLOOP_MCP_TOKEN is set', async () => {
    const fresh = await startMcp([], {});
    expect(fresh.err()).toMatch(/token: [\w-]{32}\n/);
    const fixed = await startMcp();
    expect(fixed.err()).toContain('token: from ISOLOOP_MCP_TOKEN');
    expect(fixed.err()).not.toContain(TOKEN);
  });

  it("forwards a page's read-only tools with their schemas and annotations, and tells the agent", async () => {
    const mcp = await startMcp();
    const p = await page(mcp.port, { answer: priced });
    await p.welcomed();
    await until(() => mcp.changes() === 1);
    const { tools } = await mcp.client.listTools();
    expect(appTools(tools)).toEqual(['isoloop_pages', 'markets.quote.v1', 'echo.v1']);
    const quote = tools.find((t) => t.name === 'markets.quote.v1');
    expect(quote?.title).toBe('Quote');
    expect(quote?.description).toBe(`The markets.quote.v1 tool ${UNTRUSTED_SENTENCE}`);
    expect(quote?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(quote?.inputSchema.properties).toHaveProperty('symbol');
    expect(quote?.inputSchema.properties).toHaveProperty('page');
    expect(quote?.outputSchema?.type).toBe('object');
    const echo = tools.find((t) => t.name === 'echo.v1');
    expect(echo?.inputSchema).toMatchObject({ type: 'object', required: ['input'] });
    expect(echo?.outputSchema).toBeUndefined();
  });

  it('calls a tool on the page and returns the reply, structured when the reply is an object', async () => {
    const mcp = await startMcp();
    const p = await page(mcp.port, {
      answer: (c) => (c.name === 'echo.v1' ? { ok: true, value: c.input } : priced(c)),
    });
    await p.welcomed();
    const r = await mcp.client.callTool({ name: 'markets.quote.v1', arguments: { symbol: 'BTC' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ price: 42 });
    expect(r.content).toEqual([{ type: 'text', text: '{"price":42}' }]);
    const call = p.received.find((m) => m.t === 'call');
    expect(call?.p).toEqual({ name: 'markets.quote.v1', input: { symbol: 'BTC' } });
    const e = await mcp.client.callTool({ name: 'echo.v1', arguments: { input: 'hi' } });
    expect(e.content).toEqual([{ type: 'text', text: '"hi"' }]);
  });

  it("returns the page's error as a tool error", async () => {
    const mcp = await startMcp();
    const p = await page(mcp.port, {
      answer: () => ({
        ok: false,
        code: 'no_responder',
        message: 'nobody can answer markets.quote.v1',
      }),
    });
    await p.welcomed();
    const r = await mcp.client.callTool({ name: 'markets.quote.v1', arguments: { symbol: 'BTC' } });
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([
      { type: 'text', text: 'no_responder: nobody can answer markets.quote.v1' },
    ]);
  });

  it('returns dropped as a tool error with its message', async () => {
    const mcp = await startMcp();
    const message =
      "the request was dropped: the topic's retention was full; retry or raise retention";
    const p = await page(mcp.port, { answer: () => ({ ok: false, code: 'dropped', message }) });
    await p.welcomed();
    const r = await mcp.client.callTool({ name: 'markets.quote.v1', arguments: { symbol: 'BTC' } });
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: `dropped: ${message}` }]);
  });

  it('keeps tools that change something behind --allow-write', async () => {
    const ro = await startMcp();
    const p1 = await page(ro.port, { answer: priced });
    await p1.welcomed();
    const r = await ro.client.callTool({
      name: 'markets.alerts.create.v1',
      arguments: { symbol: 'BTC' },
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('--allow-write');
    expect(p1.received.some((m) => m.t === 'call')).toBe(false);

    const rw = await startMcp(['--allow-write']);
    const p2 = await page(rw.port, { answer: priced });
    await p2.welcomed();
    const { tools } = await rw.client.listTools();
    const create = tools.find((t) => t.name === 'markets.alerts.create.v1');
    expect(create?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const ok = await rw.client.callTool({
      name: 'markets.alerts.create.v1',
      arguments: { symbol: 'BTC' },
    });
    expect(ok.structuredContent).toEqual({ price: 42 });
  });

  it('refuses a page with the wrong token', async () => {
    const mcp = await startMcp();
    const p = await page(mcp.port, { token: 'wrong' });
    await until(() => p.closeCode() !== undefined);
    expect(p.closeCode()).toBe(4401);
    const { tools } = await mcp.client.listTools();
    expect(appTools(tools)).toEqual(['isoloop_pages']);
    expect(mcp.err()).toContain('wrong token');
  });

  it('refuses a page from another origin, or with none', async () => {
    const mcp = await startMcp();
    const evil = await page(mcp.port, { origin: 'http://evil.test' });
    const none = await page(mcp.port, { origin: null });
    expect(evil.ws.readyState).toBe(WebSocket.CLOSED);
    expect(none.ws.readyState).toBe(WebSocket.CLOSED);
    expect(evil.received).toEqual([]);
    expect(mcp.err()).toContain('refused a connection from origin http://evil.test');
    expect(mcp.err()).toContain('refused a connection from origin (none)');
  });

  it('accepts another origin given with --origin', async () => {
    const mcp = await startMcp(['--origin', 'https://app.test']);
    const p = await page(mcp.port, { origin: 'https://app.test' });
    expect(await p.welcomed()).toBe('p1');
  });

  it('lists pages and routes by page, defaulting to the newest', async () => {
    const mcp = await startMcp();
    const a = await page(mcp.port, {
      url: 'http://localhost:5173/a',
      answer: () => ({ ok: true, value: { price: 1 } }),
    });
    const idA = await a.welcomed();
    const b = await page(mcp.port, {
      url: 'http://localhost:5173/b',
      answer: () => ({ ok: true, value: { price: 2 } }),
    });
    const idB = await b.welcomed();
    const list = await mcp.client.callTool({ name: 'isoloop_pages', arguments: {} });
    expect(list.structuredContent).toMatchObject({
      pages: [
        { page: idB, url: 'http://localhost:5173/b' },
        { page: idA, url: 'http://localhost:5173/a' },
      ],
    });
    const viaDefault = await mcp.client.callTool({
      name: 'markets.quote.v1',
      arguments: { symbol: 'X' },
    });
    expect(viaDefault.structuredContent).toEqual({ price: 2 });
    const viaA = await mcp.client.callTool({
      name: 'markets.quote.v1',
      arguments: { symbol: 'X', page: idA },
    });
    expect(viaA.structuredContent).toEqual({ price: 1 });
    const missing = await mcp.client.callTool({
      name: 'markets.quote.v1',
      arguments: { symbol: 'X', page: 'p99' },
    });
    expect(missing.isError).toBe(true);
  });

  it('fails a pending call when its page goes away, and drops its tools', async () => {
    const mcp = await startMcp();
    const p = await page(mcp.port, { answer: () => 'never' });
    await p.welcomed();
    const call = mcp.client.callTool({ name: 'markets.quote.v1', arguments: { symbol: 'X' } });
    await until(() => p.received.some((m) => m.t === 'call'));
    p.ws.close();
    const r = await call;
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain('page_gone');
    await until(() => mcp.changes() === 2);
    const { tools } = await mcp.client.listTools();
    expect(appTools(tools)).toEqual(['isoloop_pages']);
  });

  it("passes the agent's cancellation to the page", async () => {
    const mcp = await startMcp();
    const p = await page(mcp.port, { answer: () => 'never' });
    await p.welcomed();
    const abort = new AbortController();
    const call = mcp.client.callTool(
      { name: 'markets.quote.v1', arguments: { symbol: 'X' } },
      undefined,
      {
        signal: abort.signal,
      },
    );
    await until(() => p.received.some((m) => m.t === 'call'));
    abort.abort();
    await expect(call).rejects.toThrow();
    await until(() => p.received.some((m) => m.t === 'cancel'));
    const sent = p.received.find((m) => m.t === 'call');
    const cancel = p.received.find((m) => m.t === 'cancel');
    expect(cancel?.re).toBe(sent?.id);
  });

  it('answers an unknown tool with a JSON-RPC error and a bad --port with exit 2', async () => {
    const mcp = await startMcp();
    await expect(mcp.client.callTool({ name: 'nope', arguments: {} })).rejects.toThrow(
      /unknown tool/,
    );
    let err = '';
    const code = await main(['mcp', '--port', 'x'], {
      stdin: (async function* () {})(),
      env: {},
      out: () => {},
      err: (t) => void (err += t),
      cwd: process.cwd(),
      writeFile: () => Promise.resolve(),
      load: () => Promise.reject(new Error('no')),
    });
    expect(code).toBe(2);
    expect(err).toContain('--port must be a port number');
  });

  it('exits 0 when stdin ends, closing the pages', async () => {
    const mcp = await startMcp();
    const p = await page(mcp.port);
    await p.welcomed();
    running.splice(running.indexOf(mcp.stop), 1);
    expect(await mcp.stop()).toBe(0);
    await until(() => p.closeCode() !== undefined);
    expect(p.closeCode()).toBe(4000);
  });
});

describe("the dev MCP's own tools (M4a task 8)", () => {
  const READS = [
    'isoloop_isolates',
    'isoloop_topics',
    'isoloop_records',
    'isoloop_tap',
    'isoloop_events',
  ];
  const WRITES = [
    'isoloop_restart',
    'isoloop_kill',
    'isoloop_block',
    'isoloop_publish',
    'isoloop_request',
  ];
  const ops: DevMcpOp[] = [];
  const echoOp = (op: DevMcpOp): PageToCli['p'] => {
    ops.push(op);
    return { ok: true, value: { got: op.op } };
  };
  afterEach(() => void ops.splice(0));

  it('lists the reads always and the writes only with --allow-write', async () => {
    const ro = await startMcp();
    const roNames = (await ro.client.listTools()).tools.map((t) => t.name);
    expect(roNames).toEqual(expect.arrayContaining(READS));
    for (const w of WRITES) expect(roNames).not.toContain(w);
    const refused = await ro.client.callTool({ name: 'isoloop_kill', arguments: { id: 'a' } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('--allow-write');

    const rw = await startMcp(['--allow-write']);
    const rwNames = (await rw.client.listTools()).tools.map((t) => t.name);
    expect(rwNames).toEqual(expect.arrayContaining([...READS, ...WRITES]));
    const block = (await rw.client.listTools()).tools.find((t) => t.name === 'isoloop_block');
    expect(block?.annotations?.destructiveHint).toBe(true);
    expect(block?.inputSchema.required).toEqual(['id', 'ms']);
  });

  it('sends each tool as an op with its defaults, and returns the answer', async () => {
    const mcp = await startMcp(['--allow-write']);
    const p = await page(mcp.port, { op: echoOp });
    await p.welcomed();
    const r = await mcp.client.callTool({ name: 'isoloop_records', arguments: { topic: 'a.v1' } });
    expect(r.structuredContent).toEqual({ got: 'records' });
    await mcp.client.callTool({ name: 'isoloop_tap', arguments: { topics: ['a.v1'] } });
    await mcp.client.callTool({
      name: 'isoloop_tap',
      arguments: { topics: ['a.v1', 'b.v1'], ms: 10_000, max: 5 },
    });
    await mcp.client.callTool({ name: 'isoloop_events', arguments: {} });
    await mcp.client.callTool({ name: 'isoloop_block', arguments: { id: 'w', ms: 2_000 } });
    await mcp.client.callTool({
      name: 'isoloop_request',
      arguments: { topic: 'a.v1', value: { q: 1 }, key: 'k' },
    });
    await mcp.client.callTool({
      name: 'isoloop_publish',
      arguments: { topic: 'b.v1', value: null },
    });
    expect(ops).toEqual([
      { op: 'records', topic: 'a.v1', last: 20 },
      { op: 'tap', topics: ['a.v1'], ms: 3_000, max: 100 },
      { op: 'tap', topics: ['a.v1', 'b.v1'], ms: 10_000, max: 5 },
      { op: 'events', last: 50 },
      { op: 'block', id: 'w', ms: 2_000 },
      { op: 'request', topic: 'a.v1', value: { q: 1 }, key: 'k', timeoutMs: 10_000 },
      { op: 'publish', topic: 'b.v1', value: null },
    ]);
  });

  it('refuses bad arguments before the page sees them', async () => {
    const mcp = await startMcp(['--allow-write']);
    const p = await page(mcp.port, { op: echoOp });
    await p.welcomed();
    const bad = [
      { name: 'isoloop_records', arguments: { topic: 'a.v1', last: 101 } },
      { name: 'isoloop_records', arguments: {} },
      { name: 'isoloop_tap', arguments: {} },
      { name: 'isoloop_tap', arguments: { topics: [] } },
      { name: 'isoloop_tap', arguments: { topics: ['a.v1', 3] } },
      { name: 'isoloop_tap', arguments: { topics: ['a.v1'], ms: 10_001 } },
      { name: 'isoloop_tap', arguments: { topics: ['a.v1'], max: 101 } },
      { name: 'isoloop_block', arguments: { id: 'w', ms: 10_001 } },
      { name: 'isoloop_block', arguments: { id: 'w' } },
      { name: 'isoloop_request', arguments: { topic: 'a.v1', value: 1, timeoutMs: 30_001 } },
      { name: 'isoloop_publish', arguments: { topic: 'a.v1' } },
    ];
    for (const b of bad) {
      // oxlint-disable-next-line no-await-in-loop -- one after another, for the order of ops
      const r = await mcp.client.callTool(b);
      expect(r.isError, b.name).toBe(true);
    }
    expect(ops).toEqual([]);
  });

  it('answers only from a page that inspects, and passes its errors on', async () => {
    const mcp = await startMcp();
    const plain = await page(mcp.port);
    const plainId = await plain.welcomed();
    const none = await mcp.client.callTool({ name: 'isoloop_isolates', arguments: {} });
    expect(none.isError).toBe(true);
    expect(JSON.stringify(none.content)).toContain('no connected page answers');
    const notThat = await mcp.client.callTool({
      name: 'isoloop_isolates',
      arguments: { page: plainId },
    });
    expect(JSON.stringify(notThat.content)).toContain("doesn't pass kernel.inspect()");

    const inspecting = await page(mcp.port, {
      op: () => ({ ok: false, code: 'unknown_topic', message: 'unknown topic x.v1' }),
    });
    await inspecting.welcomed();
    const failed = await mcp.client.callTool({
      name: 'isoloop_records',
      arguments: { topic: 'x.v1' },
    });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed.content)).toContain('unknown_topic: unknown topic x.v1');
  });
});
