// connectWebMCP against a fake document.modelContext; the real one is
// covered by the chromium-webmcp E2E project (e2e/webmcp.spec.ts).
import type { AgentTool, RequestOptions } from '@isoloop/host';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWebMCP } from './index';

type Registered = {
  tool: {
    name: string;
    title?: string;
    description: string;
    inputSchema: object;
    outputSchema: object;
    annotations: Record<string, boolean>;
    execute(input: unknown, client?: { signal?: AbortSignal }): Promise<unknown>;
  };
  signal: AbortSignal | undefined;
};

function fakeContext(register?: (t: Registered) => unknown) {
  const target = new EventTarget();
  const tools: Registered[] = [];
  const mc = Object.assign(target, {
    registerTool(tool: Registered['tool'], options?: { signal?: AbortSignal }) {
      const r = { tool, signal: options?.signal };
      tools.push(r);
      return register ? register(r) : Promise.resolve();
    },
  });
  vi.stubGlobal('document', { modelContext: mc });
  return { mc, tools };
}

const tool = (name: string, extra: Partial<AgentTool> = {}): AgentTool => ({
  name,
  description: `does ${name}`,
  readOnly: true,
  consequential: false,
  untrustedContent: false,
  inputSchema: { type: 'object' },
  outputSchema: { type: 'string' },
  timeoutMs: 1234,
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- connectWebMCP only passes the topic on to the fake request
  topic: { name } as AgentTool['topic'],
  ...extra,
});

type Call = { name: string; value: unknown; opts: RequestOptions | undefined };

function fakeKernel(tools: AgentTool[], answer?: (c: Call) => Promise<unknown>) {
  const calls: Call[] = [];
  const kernel: Parameters<typeof connectWebMCP>[0] = {
    tools: () => tools,
    // The real request is generic in the reply; the fake answers `unknown`.
    request: <R>(topic: { name: string }, value: unknown, opts?: RequestOptions): Promise<R> => {
      const c = { name: topic.name, value, opts };
      calls.push(c);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tests read the reply as unknown
      return (answer ? answer(c) : Promise.resolve({ ok: c.name })) as Promise<R>;
    },
  };
  return { calls, kernel };
}

/** A request that waits for its signal and rejects like the kernel does. */
const untilAborted = (c: Call) =>
  new Promise((_, reject) =>
    c.opts?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('connectWebMCP', () => {
  it('does nothing without document.modelContext', () => {
    vi.stubGlobal('document', {});
    const tools = vi.fn(() => []);
    const off = connectWebMCP({ tools, request: vi.fn() });
    expect(tools).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
  });

  it('does nothing outside a document', () => {
    expect(typeof document).toBe('undefined');
    expect(() => connectWebMCP(fakeKernel([tool('a.v1')]).kernel)()).not.toThrow();
  });

  it('registers each tool with its schemas and hints, under one signal', () => {
    const { tools } = fakeContext();
    const { kernel } = fakeKernel([
      tool('a.v1', { title: 'A' }),
      tool('b.v1', { readOnly: false, consequential: true, untrustedContent: true }),
    ]);
    const off = connectWebMCP(kernel);
    expect(tools.map((t) => t.tool.name)).toEqual(['a.v1', 'b.v1']);
    const [a, b] = tools;
    expect(a?.tool).toMatchObject({
      name: 'a.v1',
      title: 'A',
      description: 'does a.v1',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'string' },
      annotations: { readOnlyHint: true, consequentialHint: false, untrustedContentHint: false },
    });
    expect(b?.tool).not.toHaveProperty('title');
    expect(b?.tool.annotations).toEqual({
      readOnlyHint: false,
      consequentialHint: true,
      untrustedContentHint: true,
    });
    expect(a?.signal?.aborted).toBe(false);
    off();
    expect(a?.signal?.aborted).toBe(true);
    expect(b?.signal).toBe(a?.signal);
  });

  it('calls kernel.request with the topic, the timeout and via webmcp, and returns the reply', async () => {
    const { tools } = fakeContext();
    const { kernel, calls } = fakeKernel([tool('a.v1')]);
    connectWebMCP(kernel);
    await expect(tools[0]?.tool.execute({ q: 1 })).resolves.toEqual({ ok: 'a.v1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: 'a.v1',
      value: { q: 1 },
      opts: { timeoutMs: 1234, via: 'webmcp' },
    });
    expect(calls[0]?.opts?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects with the kernel's error", async () => {
    const { tools } = fakeContext();
    const err = Object.assign(new Error('no isolate can answer a.v1'), { code: 'no_responder' });
    connectWebMCP(fakeKernel([tool('a.v1')], () => Promise.reject(err)).kernel);
    await expect(tools[0]?.tool.execute({})).rejects.toBe(err);
  });

  it("aborts a call when the browser's per-call signal aborts", async () => {
    const { tools } = fakeContext();
    const { kernel, calls } = fakeKernel([tool('a.v1')], untilAborted);
    connectWebMCP(kernel);
    const client = new AbortController();
    const p = tools[0]?.tool.execute({}, { signal: client.signal });
    client.abort();
    await expect(p).rejects.toThrow('aborted');
    expect(calls[0]?.opts?.signal?.aborted).toBe(true);
  });

  it("aborts that tool's calls in flight on toolcancel, and no other's", async () => {
    const { mc, tools } = fakeContext();
    const { kernel, calls } = fakeKernel([tool('a.v1'), tool('b.v1')], untilAborted);
    connectWebMCP(kernel);
    const a = tools[0]?.tool.execute({});
    void tools[1]?.tool.execute({});
    mc.dispatchEvent(Object.assign(new Event('toolcancel'), { toolName: 'a.v1' }));
    await expect(a).rejects.toThrow('aborted');
    expect(calls.map((c) => c.opts?.signal?.aborted)).toEqual([true, false]);
  });

  it('aborts the calls in flight when disconnected', async () => {
    const { tools } = fakeContext();
    const { kernel, calls } = fakeKernel([tool('a.v1')], untilAborted);
    const off = connectWebMCP(kernel);
    const p = tools[0]?.tool.execute({});
    off();
    await expect(p).rejects.toThrow('aborted');
    expect(calls[0]?.opts?.signal?.aborted).toBe(true);
  });

  it('warns about a tool WebMCP refuses and registers the rest', async () => {
    const { tools } = fakeContext((r) =>
      r.tool.name === 'a.v1'
        ? Promise.reject(new Error('Duplicate tool name'))
        : Promise.resolve(undefined),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectWebMCP(fakeKernel([tool('a.v1'), tool('b.v1')]).kernel);
    expect(tools.map((t) => t.tool.name)).toEqual(['a.v1', 'b.v1']);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        '[isoloop] WebMCP refused the tool a.v1: Duplicate tool name',
      ),
    );
    expect(warn).toHaveBeenCalledOnce();
  });

  it('warns when registerTool throws synchronously', () => {
    fakeContext(() => {
      throw new Error('Invalid tool name');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectWebMCP(fakeKernel([tool('a.v1')]).kernel);
    expect(warn).toHaveBeenCalledWith('[isoloop] WebMCP refused the tool a.v1: Invalid tool name');
  });
});
