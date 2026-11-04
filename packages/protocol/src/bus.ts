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
};

/** Where a new subscription starts reading. */
export type StartPosition = 'latest' | 'earliest' | 'committed';

/** Bus port: isolate → bus worker. */
export type IsolateToBus =
  /** With `id` set, the broker replies with `result`. */
  | Envelope<'publish', { topic: string; key?: string; value: unknown }>
  | Envelope<'subscribe', { topic: string; from: StartPosition; group?: string }>
  | Envelope<'unsubscribe', { topic: string }>
  | Envelope<'commit', { topic: string; offset: number }>;

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
  commit: true,
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
