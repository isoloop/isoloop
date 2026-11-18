/*
 * The page side of the CLI: the WebSocket, pairing, and the page wire
 * (`@isoloop/protocol`'s `PageToCli` / `CliToPage`) into the server core.
 */
import {
  DEV_MCP_CLOSE,
  isPageToCli,
  type CliToPage,
  type DevMcpResult,
  type DevMcpTool,
  type PageToCli,
} from '@isoloop/protocol';
import { tokenMatches } from './pairing';
import type { DevMcpServer } from './server';
import { listenWs, type WsServer } from './websocket';

/** A page that sends no `hello` within this long is closed. */
const HELLO_WAIT_MS = 5_000;

export type PagesOptions = {
  readonly port: number;
  readonly token: string;
  readonly origin: (origin: string | undefined) => boolean;
  readonly server: DevMcpServer;
  readonly log: (line: string) => void;
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function isTool(x: unknown): x is DevMcpTool {
  return (
    isObject(x) &&
    typeof x['name'] === 'string' &&
    (x['title'] === undefined || typeof x['title'] === 'string') &&
    typeof x['description'] === 'string' &&
    typeof x['readOnly'] === 'boolean' &&
    typeof x['consequential'] === 'boolean' &&
    typeof x['untrustedContent'] === 'boolean' &&
    isObject(x['inputSchema']) &&
    isObject(x['outputSchema']) &&
    typeof x['timeoutMs'] === 'number' &&
    x['timeoutMs'] > 0
  );
}

function isResult(x: unknown): x is DevMcpResult {
  if (!isObject(x)) return false;
  if (x['ok'] === true) return true;
  return x['ok'] === false && typeof x['code'] === 'string' && typeof x['message'] === 'string';
}

type Hello = Extract<PageToCli, { t: 'hello' }>;

function isHello(x: unknown): x is Hello {
  if (!isPageToCli(x) || x.t !== 'hello' || !isObject(x.p)) return false;
  const p = x.p;
  return (
    typeof p['url'] === 'string' &&
    (p['title'] === undefined || typeof p['title'] === 'string') &&
    Array.isArray(p['tools']) &&
    p['tools'].every(isTool)
  );
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Listens for pages on 127.0.0.1. Rejects when the port is taken. */
export function listenForPages(o: PagesOptions): Promise<WsServer> {
  return listenWs({
    host: '127.0.0.1',
    port: o.port,
    accept: (request) => {
      const origin = request.headers.origin;
      if (o.origin(origin)) return true;
      o.log(`refused a connection from origin ${origin ?? '(none)'}; see --origin`);
      return 403;
    },
    onConnection: (c) => {
      let page: string | undefined;
      const send = (m: CliToPage): void => c.send(JSON.stringify(m));
      const timer = setTimeout(() => c.close(DEV_MCP_CLOSE.badHello, 'no hello'), HELLO_WAIT_MS);
      c.onMessage = (text) => {
        const m = parse(text);
        if (page === undefined) {
          clearTimeout(timer);
          if (!isHello(m)) {
            o.log('refused a page: its first message was not a hello this version reads');
            c.close(DEV_MCP_CLOSE.badHello, 'expected hello');
            return;
          }
          if (!tokenMatches(o.token, m.p.token)) {
            o.log(`refused a page at ${m.p.url}: wrong token`);
            c.close(DEV_MCP_CLOSE.badToken, 'wrong token');
            return;
          }
          page = o.server.attachPage({
            url: m.p.url,
            title: m.p.title,
            tools: m.p.tools,
            send,
          });
          send({ v: 1, t: 'welcome', p: { page } });
          return;
        }
        // Later messages: results. Anything else this version doesn't know is ignored.
        if (isPageToCli(m) && m.t === 'result' && isResult(m.p)) {
          o.server.pageResult(page, m.re, m.p);
        }
      };
      c.onClose = () => {
        clearTimeout(timer);
        if (page !== undefined) o.server.detachPage(page);
      };
    },
  });
}
