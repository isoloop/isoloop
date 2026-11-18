/*
 * The dev MCP's page wire (ADR 0018, decision 8; M4a decisions 9–13): JSON
 * text frames over the WebSocket between a page's `connectDevMCP` and the
 * `isoloop mcp` CLI. Both ship at one version, so this is internal; a page
 * and a CLI of different versions refuse each other at `hello` when `v`
 * differs, and ignore message types they don't know.
 */
import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { Issue } from './errors';

/**
 * An exposed tool as the page sends it: `kernel.tools()` without `topic`.
 * @internal
 */
export type DevMcpTool = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly readOnly: boolean;
  readonly consequential: boolean;
  readonly untrustedContent: boolean;
  readonly inputSchema: { readonly [key: string]: unknown };
  readonly outputSchema: { readonly [key: string]: unknown };
  readonly timeoutMs: number;
};

/** A call's answer: the reply, or the error's code and message. @internal */
export type DevMcpResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      /** A `BusError` code, or `unknown_tool` for a name the page doesn't expose. */
      readonly code: string;
      readonly message: string;
      readonly issues?: readonly Issue[];
    };

/** `hello`'s payload: the pairing token, the page's URL and title, and its tools. @internal */
export type DevMcpHello = {
  readonly token: string;
  readonly url: string;
  readonly title?: string;
  readonly tools: readonly DevMcpTool[];
};

/** `welcome`'s payload: the page's id, which agents pass as `page`. @internal */
export type DevMcpWelcome = { readonly page: string };

/** `call`'s payload: the tool to request and its input. @internal */
export type DevMcpCall = { readonly name: string; readonly input: unknown };

/**
 * Page → CLI: `hello` first, then a `result` per call (`re` = the call's `id`).
 * @internal
 */
export type PageToCli = Envelope<'hello', DevMcpHello> | Envelope<'result', DevMcpResult>;

/**
 * CLI → page: `welcome` once paired; `call`, with an `id`; `cancel`, `re` = a
 * call's `id`, when the agent cancelled it (the page aborts its signal).
 * @internal
 */
export type CliToPage =
  | Envelope<'welcome', DevMcpWelcome>
  | Envelope<'call', DevMcpCall>
  | Envelope<'cancel', DevMcpCancel>;

/** `cancel`'s payload: empty. @internal */
export type DevMcpCancel = Record<string, never>;

/** @internal */
export const PAGE_TO_CLI: MessageTypes<PageToCli> = { hello: true, result: true };
/** @internal */
export const CLI_TO_PAGE: MessageTypes<CliToPage> = { welcome: true, call: true, cancel: true };

/** @internal */
export const isPageToCli: (x: unknown) => x is PageToCli = envelopeGuard<PageToCli>(PAGE_TO_CLI);
/** @internal */
export const isCliToPage: (x: unknown) => x is CliToPage = envelopeGuard<CliToPage>(CLI_TO_PAGE);

/**
 * WebSocket close codes the CLI uses (4000–4999 are the application's).
 * @internal
 */
export const DEV_MCP_CLOSE = {
  /** The first message wasn't a well-formed `hello`, or its `v` differs. */
  badHello: 4400,
  /** The token didn't match. */
  badToken: 4401,
  /** The CLI is shutting down. */
  shutdown: 4000,
} as const;

/** The CLI's WebSocket port when `--port` isn't given. @internal */
export const DEV_MCP_PORT = 4317;
