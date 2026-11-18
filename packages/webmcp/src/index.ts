/*
 * `@isoloop/webmcp` (ADR 0018, decision 8; M4a decisions 14–15): registers
 * the tools an app exposes through `agents.expose` with the browser's WebMCP
 * API, so a browser agent can call them. Each call goes through
 * `kernel.request(…, { via: 'webmcp' })`.
 *
 * WebMCP is a Community Group draft, behind a flag in Chromium
 * (`--enable-features=WebMCP`). It has moved before, so this package is
 * `@experimental` and follows it on its own, outside `@isoloop/host`.
 */
import type { AgentTool, Kernel } from '@isoloop/host';

/** The slice of WebMCP's `ModelContext` this package uses (the draft, as Chromium 158 ships it). */
type ModelContext = EventTarget & {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
};

type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
  annotations: { readOnlyHint: boolean; consequentialHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown, client?: { signal?: AbortSignal }): Promise<unknown>;
};

/** `document.modelContext`, or `undefined` where WebMCP is missing or off. */
function modelContext(): ModelContext | undefined {
  if (typeof document === 'undefined') return undefined;
  const mc: unknown = Reflect.get(document, 'modelContext');
  if (typeof mc !== 'object' || mc === null) return undefined;
  if (typeof Reflect.get(mc, 'registerTool') !== 'function') return undefined;
  if (typeof Reflect.get(mc, 'addEventListener') !== 'function') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just above: an EventTarget with registerTool
  return mc as ModelContext;
}

/** Aborts `target` when any of `signals` aborts; returns the cleanup. */
function follow(target: AbortController, signals: readonly AbortSignal[]): () => void {
  const abort = () => target.abort();
  for (const s of signals) {
    if (s.aborted) target.abort();
    else s.addEventListener('abort', abort, { once: true });
  }
  return () => {
    for (const s of signals) s.removeEventListener('abort', abort);
  };
}

/**
 * Registers every tool `kernel.tools()` lists with WebMCP's
 * `document.modelContext.registerTool`, with its name, title, description,
 * JSON Schemas and hints (`readOnlyHint`, `consequentialHint`,
 * `untrustedContentHint`). A call runs
 * `kernel.request(tool.topic, input, { timeoutMs: tool.timeoutMs, signal, via: 'webmcp' })`
 * and resolves with the reply; a failed call rejects with the kernel's
 * `BusError` (its `code` and `message`), for example `timeout` or
 * `no_responder`. Browsers show the agent their own generic error.
 *
 * - Where `document.modelContext` is missing (no WebMCP, or the flag off),
 *   it does nothing and returns a function that does nothing.
 * - Tools stay registered while their isolates restart.
 * - A call is aborted (`BusError('aborted')`) when the browser cancels it:
 *   through the call's own signal, or a `toolcancel` event, which names only
 *   the tool, so it aborts every call of that tool in flight.
 * - The returned function unregisters every tool and aborts the calls still
 *   in flight.
 *
 * There is no shim for browsers without WebMCP; during development the dev
 * MCP (`@isoloop/host/dev-mcp`) covers them. A tool's hints tell the agent
 * what it does; asking the user before a consequential call is the agent's
 * job.
 *
 * ```ts
 * import { connectWebMCP } from '@isoloop/webmcp';
 * const disconnect = connectWebMCP(kernel);
 * ```
 *
 * @param kernel A kernel created with `agents.expose` (only `tools()` and
 *   `request()` are used).
 * @returns A function that unregisters the tools.
 * @experimental
 */
export function connectWebMCP(kernel: Pick<Kernel, 'tools' | 'request'>): () => void {
  const mc = modelContext();
  if (!mc) return () => {};
  const registrations = new AbortController();
  const all = registrations.signal;
  const inFlight = new Map<string, Set<AbortController>>();

  // `toolcancel` carries the tool's name only (Chromium 158), not the call.
  mc.addEventListener(
    'toolcancel',
    (e) => {
      const name: unknown = Reflect.get(e, 'toolName');
      if (typeof name !== 'string') return;
      for (const call of inFlight.get(name) ?? []) call.abort();
    },
    { signal: all },
  );

  const call = async (tool: AgentTool, input: unknown, client: unknown): Promise<unknown> => {
    const own: unknown =
      typeof client === 'object' && client !== null ? Reflect.get(client, 'signal') : undefined;
    const ctl = new AbortController();
    const unfollow = follow(ctl, own instanceof AbortSignal ? [all, own] : [all]);
    let calls = inFlight.get(tool.name);
    if (!calls) inFlight.set(tool.name, (calls = new Set()));
    calls.add(ctl);
    try {
      return await kernel.request(tool.topic, input, {
        timeoutMs: tool.timeoutMs,
        signal: ctl.signal,
        via: 'webmcp',
      });
    } finally {
      unfollow();
      calls.delete(ctl);
      if (calls.size === 0) inFlight.delete(tool.name);
    }
  };

  for (const tool of kernel.tools()) {
    let registered: unknown;
    try {
      registered = mc.registerTool(
        {
          name: tool.name,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: {
            readOnlyHint: tool.readOnly,
            consequentialHint: tool.consequential,
            untrustedContentHint: tool.untrustedContent,
          },
          execute: (input, client) => call(tool, input, client),
        },
        { signal: all },
      );
    } catch (e) {
      warn(tool.name, e);
      continue;
    }
    // Chromium's registerTool returns a promise, rejected for example on a
    // name the page registered already.
    if (registered instanceof Promise) registered.catch((e: unknown) => warn(tool.name, e));
  }

  return () => registrations.abort();
}

function warn(name: string, e: unknown): void {
  console.warn(
    `[isoloop] WebMCP refused the tool ${name}: ${e instanceof Error ? e.message : String(e)}`,
  );
}
