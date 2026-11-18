/*
 * `@isoloop/host/dev-mcp` (ADR 0018, decision 8; M4a decisions 10–13): the
 * page side of the dev MCP. It dials the `isoloop mcp` CLI's WebSocket, sends
 * the kernel's exposed tools, and answers the CLI's calls through
 * `kernel.request(…, { via: 'mcp' })`.
 *
 * For development only: import it behind `import.meta.env.DEV`, and
 * `@isoloop/vite` fails a production build that still contains it.
 *
 * ```ts
 * if (import.meta.env.DEV) {
 *   const { connectDevMCP } = await import('@isoloop/host/dev-mcp');
 *   connectDevMCP(kernel, { token: import.meta.env.VITE_ISOLOOP_MCP_TOKEN });
 * }
 * ```
 *
 * Vite only shows the page `VITE_`-prefixed variables, so for a fixed token
 * set the same value twice: `ISOLOOP_MCP_TOKEN` for the CLI and
 * `VITE_ISOLOOP_MCP_TOKEN` for the page. Or paste the token the CLI printed.
 *
 * It keeps trying while the CLI isn't running, and reconnects after the CLI
 * restarts, backing off to one try every 30 s. A wrong token or a bad hello
 * stops it.
 */
import {
  BusError,
  DEV_MCP_CLOSE,
  DEV_MCP_PORT,
  isCliToPage,
  type DevMcpResult,
  type DevMcpTool,
  type PageToCli,
} from '@isoloop/protocol';
import type { AgentTool } from './agents';
import type { Kernel } from './kernel';

/** `connectDevMCP`'s options. @experimental */
export type DevMcpOptions = {
  /** The CLI's WebSocket. Default `ws://127.0.0.1:4317`. */
  readonly url?: string;
  /**
   * The token `isoloop mcp` printed, or its fixed `ISOLOOP_MCP_TOKEN`, which
   * the page sees only under a `VITE_` name (`VITE_ISOLOOP_MCP_TOKEN`).
   */
  readonly token: string;
  /** What `isoloop_pages` shows as the page's title. Default `document.title`. */
  readonly title?: string;
};

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

const toWire = (t: AgentTool): DevMcpTool => {
  const { topic: _topic, ...rest } = t;
  return rest;
};

function failure(e: unknown): DevMcpResult {
  if (e instanceof BusError) {
    return {
      ok: false,
      code: e.code,
      message: e.message,
      ...(e.issues === undefined ? {} : { issues: e.issues }),
    };
  }
  return { ok: false, code: 'error', message: e instanceof Error ? e.message : String(e) };
}

function send(socket: WebSocket, m: PageToCli): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
}

/**
 * Connects the page to the dev MCP (`isoloop mcp`), so an agent can list and
 * call the tools the kernel exposes (`agents.expose`). Each call is a
 * `kernel.request` with `via: 'mcp'` and the tool's `timeoutMs`; an agent's
 * cancellation aborts it. Returns a function that disconnects and aborts the
 * calls in flight.
 * @experimental
 */
export function connectDevMCP(
  kernel: Pick<Kernel, 'tools' | 'request'>,
  options: DevMcpOptions,
): () => void {
  const url = options.url ?? `ws://127.0.0.1:${DEV_MCP_PORT}`;
  const tools = new Map(kernel.tools().map((t) => [t.name, t]));
  const calls = new Map<string, AbortController>();
  let ws: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let wait = FIRST_RETRY_MS;
  let stopped = false;

  const abortAll = (): void => {
    for (const c of calls.values()) c.abort();
    calls.clear();
  };

  const call = (socket: WebSocket, id: string, name: string, input: unknown): void => {
    const tool = tools.get(name);
    if (tool === undefined) {
      send(socket, {
        v: 1,
        t: 'result',
        re: id,
        p: { ok: false, code: 'unknown_tool', message: `this page doesn't expose ${name}` },
      });
      return;
    }
    const controller = new AbortController();
    calls.set(id, controller);
    void kernel
      .request(tool.topic, input, {
        timeoutMs: tool.timeoutMs,
        signal: controller.signal,
        via: 'mcp',
      })
      .then(
        (value): DevMcpResult => ({ ok: true, value }),
        (e: unknown) => failure(e),
      )
      .then((result) => {
        // A cancelled call answers nothing: the agent asked for no response.
        if (calls.get(id) !== controller) return;
        calls.delete(id);
        send(socket, { v: 1, t: 'result', re: id, p: result });
      });
  };

  const connect = (): void => {
    retry = undefined;
    if (stopped) return;
    const socket = new WebSocket(url);
    ws = socket;
    socket.addEventListener('open', () => {
      send(socket, {
        v: 1,
        t: 'hello',
        p: {
          token: options.token,
          url: location.href,
          title: options.title ?? document.title,
          tools: [...tools.values()].map(toWire),
        },
      });
    });
    socket.addEventListener('message', (e: MessageEvent) => {
      let m: unknown;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!isCliToPage(m)) return;
      if (m.t === 'welcome') {
        wait = FIRST_RETRY_MS;
        console.info(`[isoloop] dev MCP connected as page ${m.p.page} (${tools.size} tools)`);
      } else if (m.t === 'call' && m.id !== undefined) {
        call(socket, m.id, m.p.name, m.p.input);
      } else if (m.t === 'cancel' && m.re !== undefined) {
        const c = calls.get(m.re);
        calls.delete(m.re);
        c?.abort();
      }
    });
    socket.addEventListener('close', (e: CloseEvent) => {
      if (ws !== socket) return;
      ws = undefined;
      abortAll();
      if (stopped) return;
      if (e.code === DEV_MCP_CLOSE.badToken || e.code === DEV_MCP_CLOSE.badHello) {
        console.warn(
          `[isoloop] the dev MCP at ${url} refused this page (${e.reason || e.code}); check the token isoloop mcp printed`,
        );
        return;
      }
      retry = setTimeout(connect, wait);
      wait = Math.min(wait * 2, MAX_RETRY_MS);
    });
  };

  connect();
  return () => {
    stopped = true;
    if (retry !== undefined) clearTimeout(retry);
    abortAll();
    const socket = ws;
    ws = undefined;
    socket?.close(1000, 'disconnected');
  };
}
