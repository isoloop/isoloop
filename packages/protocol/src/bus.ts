import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { CallResult } from './errors';

/** One record in a topic's log (design §6.1). */
export type BusRecord = {
  offset: number;
  key?: string;
  value: unknown;
  /** `Date.now()` at append. */
  ts: number;
  /** Isolate id of the publisher. */
  producer: string;
  /**
   * Set on a `bus.request` record: the caller's isolate id and its request id.
   * A recipient answers with `reply { topic, offset }` (design §6.3).
   */
  req?: { from: string; id: string };
};

/**
 * Identifies a publish so a re-send after a bus crash isn't appended twice to
 * a persistent topic (ADR 0007, step 5): `epoch` names the publisher's
 * instance (new after an isolate restart or a page load), `seq` counts its
 * publishes and requests. The bus answers a re-send it already holds with the
 * original offset. Memory topics ignore it.
 */
export type PublishId = { epoch?: number; seq?: number };

/** Where a new subscription starts reading. */
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
   * at half a subscription's credit, on shutdown and on a new port.
   */
  | Envelope<'commits', { offsets: { topic: string; offset: number }[] }>
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
  /** `gap` marks records that expired before delivery. */
  | Envelope<'deliver', { topic: string; records: BusRecord[]; gap?: { from: number; to: number } }>
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
