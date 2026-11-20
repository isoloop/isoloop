/*
 * `@isoloop/webmcp` (ADR 0018, decision 8; M4a decisions 14–15): registers
 * the tools an app exposes through `agents.expose` with the browser's WebMCP
 * API, so a browser agent can call them. Each call goes through
 * `kernel.request(…, { via: 'webmcp' })`.
 *
 * WebMCP is a Community Group draft, behind a flag in Chromium
 * (`--enable-features=WebMCP`) and behind prefs in Firefox
 * (`dom.modelcontext.enabled`). The two differ (ADR 0018, decision 8,
 * "Browsers that differ") and the draft has moved before, so this package is
 * `@experimental`, follows it on its own outside `@isoloop/host`, and detects
 * features rather than browsers.
 */
import { KernelError, type AgentTool, type Kernel } from '@isoloop/host';

/**
 * The slice of WebMCP's `ModelContext` this package uses. Chromium 158's is an
 * `EventTarget` (for `toolcancel`) and removes a tool when its registration
 * signal aborts; Firefox 159's is neither, and has `unregisterTool` instead.
 */
type ModelContext = {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): unknown;
  addEventListener?: EventTarget['addEventListener'];
  unregisterTool?: (name: string) => unknown;
};

type WebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
  annotations: { readOnlyHint?: true; consequentialHint?: true; untrustedContentHint?: true };
  execute(input: unknown, client?: { signal?: AbortSignal }): Promise<unknown>;
};

/** `owner.modelContext` if it's an object with a `registerTool` method. */
function contextOn(owner: object | undefined): ModelContext | undefined {
  if (owner === undefined) return undefined;
  const mc: unknown = Reflect.get(owner, 'modelContext');
  if (typeof mc !== 'object' || mc === null) return undefined;
  if (typeof Reflect.get(mc, 'registerTool') !== 'function') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just above: has registerTool; the optional methods are checked where they're used
  return mc as ModelContext;
}

/**
 * `document.modelContext` (the draft, Chromium), else
 * `navigator.modelContext` (Firefox 159), or `undefined` where WebMCP is
 * missing or off.
 */
function modelContext(): ModelContext | undefined {
  return (
    contextOn(typeof document === 'undefined' ? undefined : document) ??
    contextOn(typeof navigator === 'undefined' ? undefined : navigator)
  );
}

/**
 * The names `connectWebMCP` registered on each `ModelContext`, so a duplicate
 * fails the same way in every browser: Chromium rejects it, but Firefox 159
 * silently replaces the tool (ADR 0018, decision 8, "Browsers that differ").
 */
const ours = new WeakMap<ModelContext, Set<string>>();

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
 * Registers every tool `kernel.tools()` lists with WebMCP's `registerTool`
 * (on `document.modelContext`, or on `navigator.modelContext` where only
 * that exists), with its name, title, description, JSON Schemas and hints
 * (`readOnlyHint`, `consequentialHint`, `untrustedContentHint`, each sent
 * only when true). A call runs
 * `kernel.request(tool.topic, input, { timeoutMs: tool.timeoutMs, signal, via: 'webmcp' })`
 * and resolves with the reply; a failed call rejects with the kernel's
 * `BusError` (its `code` and `message`), for example `timeout`,
 * `no_responder` or `dropped`. Chromium shows the agent its own generic error; Firefox
 * passes the message on.
 *
 * - Where neither exists (no WebMCP, or the flag off), it does nothing and
 *   returns a function that does nothing.
 * - Tools stay registered while their isolates restart.
 * - A call is aborted (`BusError('aborted')`) when the browser cancels it:
 *   through the call's own signal, or a `toolcancel` event, which names only
 *   the tool, so it aborts every call of that tool in flight. Where the
 *   browser gives neither (Firefox 159), a call runs until its reply or its
 *   `timeoutMs`.
 * - A tool name it already registered on this page and hasn't unregistered
 *   (a second `connectWebMCP` before the first disconnects) throws
 *   `KernelError('invalid_config')` naming the tool, and nothing is
 *   registered. Names other scripts registered aren't seen.
 * - The returned function unregisters every tool (it aborts the registration
 *   signal, and calls `unregisterTool` where that exists) and aborts the
 *   calls still in flight.
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
 * @throws {KernelError} `invalid_config` when one of the tools is already
 *   registered by an earlier `connectWebMCP` on this page.
 * @experimental
 */
export function connectWebMCP(kernel: Pick<Kernel, 'tools' | 'request'>): () => void {
  const mc = modelContext();
  if (!mc) return () => {};
  const tools = kernel.tools();
  let names = ours.get(mc);
  if (!names) ours.set(mc, (names = new Set()));
  const taken = names;
  for (const tool of tools) {
    if (taken.has(tool.name)) {
      throw new KernelError(
        'invalid_config',
        `connectWebMCP: the tool ${tool.name} is already registered with WebMCP on this page`,
      );
    }
  }
  const registrations = new AbortController();
  const all = registrations.signal;
  const inFlight = new Map<string, Set<AbortController>>();

  // `toolcancel` carries the tool's name only (Chromium 158), not the call.
  // Firefox 159's ModelContext isn't an EventTarget and has no such event.
  if (typeof mc.addEventListener === 'function') {
    mc.addEventListener(
      'toolcancel',
      (e) => {
        const name: unknown = Reflect.get(e, 'toolName');
        if (typeof name !== 'string') return;
        for (const call of inFlight.get(name) ?? []) call.abort();
      },
      { signal: all },
    );
  }

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

  const registered: string[] = [];
  for (const tool of tools) {
    let result: unknown;
    try {
      result = mc.registerTool(
        {
          name: tool.name,
          ...(tool.title === undefined ? {} : { title: tool.title }),
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: hints(tool),
          execute: (input, client) => call(tool, input, client),
        },
        { signal: all },
      );
    } catch (e) {
      warn(tool.name, e);
      continue;
    }
    registered.push(tool.name);
    taken.add(tool.name);
    // Chromium's registerTool returns a promise, rejected for example on a
    // name the page registered already.
    if (result instanceof Promise) result.catch((e: unknown) => warn(tool.name, e));
  }

  let disconnected = false;
  return () => {
    if (disconnected) return;
    disconnected = true;
    registrations.abort();
    for (const name of registered) taken.delete(name);
    // Firefox 159 ignores the registration signal and removes tools by name.
    const unregister = mc.unregisterTool;
    if (typeof unregister !== 'function') return;
    for (const name of registered) {
      try {
        Reflect.apply(unregister, mc, [name]);
      } catch {
        // Already gone; nothing to undo.
      }
    }
  };
}

/**
 * The tool's hints, only those that are true: the draft's defaults are false,
 * and Firefox 159 lists a tool as read-only whenever `readOnlyHint` is
 * present, even as `false` (ADR 0018, decision 8, "Browsers that differ").
 */
function hints(tool: AgentTool): WebMcpTool['annotations'] {
  return {
    ...(tool.readOnly ? { readOnlyHint: true } : {}),
    ...(tool.consequential ? { consequentialHint: true } : {}),
    ...(tool.untrustedContent ? { untrustedContentHint: true } : {}),
  };
}

function warn(name: string, e: unknown): void {
  console.warn(
    `[isoloop] WebMCP refused the tool ${name}: ${e instanceof Error ? e.message : String(e)}`,
  );
}
