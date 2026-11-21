/*
 * The dev MCP's page wire (ADR 0018, decision 8; M4a decisions 9–13): JSON
 * text frames over the WebSocket between a page's `connectDevMCP` and the
 * `isoloop mcp` CLI. Both ship at one version, so this is internal; a page
 * and a CLI of different versions refuse each other at `hello` when `v`
 * differs, and ignore message types they don't know.
 */
import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { Issue } from '../errors/errors';

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
  /**
   * The page answers `op` messages through `kernel.inspect()` (M4a task 8): the
   * CLI then offers it the `isoloop_*` reads, and with `--allow-write` the
   * writes. Absent: only the page's own tools.
   */
  readonly inspect?: boolean;
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
 * CLI → page: `welcome` once paired; `call` (an app tool) or `op` (one of the
 * dev MCP's own tools), each with an `id`; `cancel`, `re` = a call's `id`,
 * when the agent cancelled it (the page aborts its signal).
 * @internal
 */
export type CliToPage =
  | Envelope<'welcome', DevMcpWelcome>
  | Envelope<'call', DevMcpCall>
  | Envelope<'op', DevMcpOp>
  | Envelope<'cancel', DevMcpCancel>;

/**
 * `op`'s payload: one of the dev MCP's own tools, answered by the page from
 * `kernel.inspect()` (ADR 0020) or the kernel (M4a decision 12). The page
 * answers with a `result`, `re` = the op's `id`. The writes (`restart`,
 * `kill`, `block`, `publish`, `request`) are sent only with `--allow-write`.
 * @internal
 */
export type DevMcpOp =
  | { readonly op: 'isolates' }
  | { readonly op: 'topics' }
  | { readonly op: 'records'; readonly topic: string; readonly last: number }
  /** A live sample: tap `topics` for `ms`, stopping early at `max` records. */
  | {
      readonly op: 'tap';
      readonly topics: readonly string[];
      readonly ms: number;
      readonly max: number;
    }
  | { readonly op: 'events'; readonly last: number }
  | { readonly op: 'restart' | 'kill'; readonly id: string }
  | { readonly op: 'block'; readonly id: string; readonly ms: number }
  | {
      readonly op: 'publish';
      readonly topic: string;
      readonly key?: string;
      readonly value: unknown;
    }
  | {
      readonly op: 'request';
      readonly topic: string;
      readonly key?: string;
      readonly value: unknown;
      readonly timeoutMs: number;
    };

/** `DevMcpOp['op']`, as a list. @internal */
export const DEV_MCP_OPS: readonly DevMcpOp['op'][] = [
  'isolates',
  'topics',
  'records',
  'tap',
  'events',
  'restart',
  'kill',
  'block',
  'publish',
  'request',
];

/** `cancel`'s payload: empty. @internal */
export type DevMcpCancel = Record<string, never>;

/** @internal */
export const PAGE_TO_CLI: MessageTypes<PageToCli> = { hello: true, result: true };
/** @internal */
export const CLI_TO_PAGE: MessageTypes<CliToPage> = {
  welcome: true,
  call: true,
  op: true,
  cancel: true,
};

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
