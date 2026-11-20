import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { CallResult } from './errors';

/** One record in a topic's log. */
export type BusRecord = {
  /** Its place in the topic's log, from 0. */
  offset: number;
  /** The key it was published with, if any. */
  key?: string;
  /** The value, checked against the topic's schema. */
  value: unknown;
  /** `Date.now()` at append. */
  ts: number;
  /** Isolate id of the publisher. */
  producer: string;
  /**
   * Set on a `bus.request` record: the caller's isolate id (`'host'` for
   * `kernel.request`) and its request id. A recipient answers with
   * `bus.reply(record, value)`. `via` names the agent transport that made the
   * call; an isolate's own `bus.request` never sets it.
   */
  req?: RecordReq;
};

/**
 * The agent transports that call through `kernel.request`: `mcp` (the dev
 * MCP) and `webmcp` (WebMCP). Nothing in Isoloop sets `builder`.
 *
 * Self-declared by the caller: a label for logging and policy between
 * cooperating code on one page. Never authorize anything by it.
 * @experimental
 */
export type RequestVia = 'mcp' | 'webmcp' | 'builder';

/** Every {@link RequestVia}, for guards. @experimental */
export const REQUEST_VIA: readonly RequestVia[] = Object.freeze(['mcp', 'webmcp', 'builder']);

/** True for a known {@link RequestVia}. @experimental */
export function isRequestVia(x: unknown): x is RequestVia {
  return typeof x === 'string' && (REQUEST_VIA as readonly string[]).includes(x);
}

/** `BusRecord.req`: who asked, under which request id, and through which transport. */
export type RecordReq = { from: string; id: string; via?: RequestVia };

/**
 * True for a well-formed `BusRecord.req`: string `from` and `id`, and `via`
 * absent or a known {@link RequestVia}.
 */
export function isRecordReq(x: unknown): x is RecordReq {
  if (typeof x !== 'object' || x === null) return false;
  const via: unknown = Reflect.get(x, 'via');
  return (
    typeof Reflect.get(x, 'from') === 'string' &&
    typeof Reflect.get(x, 'id') === 'string' &&
    (via === undefined || isRequestVia(via))
  );
}

/**
 * Identifies a publish so a re-send after a bus crash isn't appended twice to
 * a persistent topic (ADR 0007, step 5): `epoch` names the publisher's
 * instance (new after an isolate restart or a page load), `seq` counts its
 * publishes and requests. The bus answers a re-send it already holds with the
 * original offset. Memory topics ignore it.
 */
export type PublishId = { epoch?: number; seq?: number };

/**
 * Where a new subscription starts reading: `latest`, only records appended
 * from now on; `earliest`, the oldest record still retained; `committed`,
 * after the last record this subscriber committed, or the oldest retained
 * when it has committed none.
 */
export type StartPosition = 'latest' | 'earliest' | 'committed';

/** Bus port: isolate → bus worker. */
export type IsolateToBus =
  /** With `id` set, the broker replies with `result`. */
  | Envelope<'publish', { topic: string; key?: string; value: unknown } & PublishId>
  | Envelope<'subscribe', { topic: string; from: StartPosition; group?: string }>
  | Envelope<'unsubscribe', { topic: string }>
  /**
   * Each entry is the highest settled offset of one subscription on this port
   * (ADR 0016, decision 1): at most one message per commit interval, earlier
   * at half a subscription's credit, on shutdown and on a new port. `seq` is
   * the highest `deliver` whose records, and those of every earlier one on
   * the subscription, are all settled; a group commit covers only records
   * with `offset ≤ offset` and `seq ≤ seq` (ADR 0016, points 11–12), and
   * the first `partial` records of delivery `seq + 1`, when it's partly
   * settled (point 17).
   */
  | Envelope<
      'commits',
      { offsets: { topic: string; offset: number; seq: number; partial?: number }[] }
    >
  /**
   * `bus.request`: appended like a publish, with `req` set on the record. `id`
   * is required; the reply (or `reply_invalid`) comes back as `result { re: id }`.
   * The broker forgets the request after `timeoutMs`; the caller raises the timeout.
   */
  | Envelope<
      'request',
      { topic: string; key?: string; value: unknown; timeoutMs: number } & PublishId
    >
  /** Answers the request record at `offset`. With `id` set, the responder gets `result`. */
  | Envelope<'reply', { topic: string; offset: number; value: unknown }>;

/** Bus port: bus worker → isolate. */
export type BusToIsolate =
  /**
   * `gap` marks records that expired before delivery. `seq` counts the
   * deliveries to this subscription on this connection, from 1 at each
   * `subscribe` (ADR 0016, point 10).
   */
  | Envelope<
      'deliver',
      { topic: string; records: BusRecord[]; gap?: { from: number; to: number }; seq: number }
    >
  /** A memory topic was lost in a bus restart (ADR 0007). */
  | Envelope<'reset', { topic: string; reason: 'bus_restart' }>
  | Envelope<'result', CallResult>;

export const ISOLATE_TO_BUS: MessageTypes<IsolateToBus> = {
  publish: true,
  subscribe: true,
  unsubscribe: true,
  commits: true,
  request: true,
  reply: true,
};

export const BUS_TO_ISOLATE: MessageTypes<BusToIsolate> = {
  deliver: true,
  reset: true,
  result: true,
};

export const isIsolateToBus: (x: unknown) => x is IsolateToBus =
  envelopeGuard<IsolateToBus>(ISOLATE_TO_BUS);

export const isBusToIsolate: (x: unknown) => x is BusToIsolate =
  envelopeGuard<BusToIsolate>(BUS_TO_ISOLATE);
