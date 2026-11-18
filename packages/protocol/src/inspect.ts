// The inspection feed's messages (ADR 0020, decisions 1, 2, 5 and 7). Every
// reader gets the same plain, structured-cloneable messages: an `Inspector`
// on the host, an isolate holding the `inspect` grant over its port, and the
// dev MCP over its WebSocket. The format only grows: readers ignore fields and
// message types they don't know, so a reader built apart keeps working
// against a newer kernel.

import type { BusMetrics, RecordPreview } from './control';
import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { CallResult } from './errors';
import type { Grants } from './grants';

/**
 * One isolate in the feed, as `kernel.isolates()` has it.
 * `state` and `reason` are the kernel's `IsolateState` and `CrashReason`,
 * typed as strings here so a reader built against an older list still reads
 * a newer kernel's values.
 * @experimental
 */
export type InspectIsolate = {
  id: string;
  state: string;
  pool?: string;
  /** `performance.now()` on the host when its last beat arrived. */
  lastBeatAt: number;
  lagMs: number;
  restarts: number;
  reason?: string;
  error?: string;
  /** Compositor figures for a visual isolate (`SurfaceStats`). */
  surface?: {
    queued: number;
    applied: number;
    rejected: number;
    dropped: number;
    lastFrameMs: number;
  };
  dropped: number;
  holds?: { ageMs: number; stack?: string }[];
  busyMs?: number;
};

/** One pool in the feed, as `kernel.pools()` has it. @experimental */
export type InspectPool = {
  name: string;
  members: string[];
  running: boolean;
  grants: Grants;
  sharesDocument: boolean;
  warning?: string;
};

/**
 * One kernel event, at once or from the ring buffer (ADR 0020, decisions 2
 * and 5). `event` is a `KernelEvents` name (`isolate:crash`, `bus:restart`, …)
 * and `data` its payload. Beats and bus metrics come as their own messages.
 * @experimental
 */
export type InspectEvent = {
  /** `performance.now()` on the host when it happened. */
  at: number;
  event: string;
  data: Record<string, unknown>;
};

/** One isolate's latest beat in a `beats` message. @experimental */
export type InspectBeat = {
  id: string;
  pool?: string;
  lagMs: number;
  busyMs?: number;
  /** `performance.now()` on the host when it arrived. */
  at: number;
};

/**
 * The bus as the feed sees it. `state` is the bus supervisor's state
 * (`running`, `restarting`, `failed`, …), or `none` without contracts.
 * `restarts` counts bus restarts since the kernel started.
 * @experimental
 */
export type InspectBus = {
  state: string;
  restarts: number;
  /** The last `bus:metrics`, once one has arrived. */
  metrics?: BusMetrics;
};

/** What a reader gets first (ADR 0020, decision 2). @experimental */
export type InspectSnapshot = {
  /** `performance.now()` on the host when it was taken. */
  at: number;
  isolates: InspectIsolate[];
  pools: InspectPool[];
  bus: InspectBus;
  /** The ring buffer: the last 200 events since the kernel started, oldest first. */
  events: InspectEvent[];
};

/**
 * The feed's messages, in the usual envelope (ADR 0020, decision 7):
 * - `snapshot`, on request: an isolate's `ctx.inspector.snapshot()` gets it
 *   over its `inspect` port, as the reply to its `snapshot` call;
 * - `event`, a kernel event as it happens;
 * - `beats`, each isolate's latest beat, coalesced to about one a second;
 * - `metrics`, the latest `bus:metrics`, at most one a second.
 * @experimental
 */
export type InspectMessage =
  | Envelope<'snapshot', InspectSnapshot>
  | Envelope<'event', InspectEvent>
  | Envelope<'beats', { at: number; beats: InspectBeat[] }>
  | Envelope<'metrics', BusMetrics>;

/** @experimental */
export const INSPECT_MESSAGES: MessageTypes<InspectMessage> = {
  snapshot: true,
  event: true,
  beats: true,
  metrics: true,
};

/**
 * True for an envelope of a feed message this build knows. A reader drops
 * anything else, which is how it ignores message types added later.
 * @experimental
 */
export const isInspectMessage: (x: unknown) => x is InspectMessage =
  envelopeGuard(INSPECT_MESSAGES);

/** How many events the kernel keeps for late readers (ADR 0020, decision 5). */
export const INSPECT_RING_SIZE = 200;

/** How often beats and bus metrics are coalesced (ADR 0020, decision 2). */
export const INSPECT_COALESCE_MS = 1_000;

/**
 * One record from a tap or a read (ADR 0020, decision 3): its value cut to a
 * 2 KB preview, with its full size.
 * @experimental
 */
export type InspectRecord = RecordPreview;

/** What an isolate asks over its `inspect` port (ADR 0020, decision 6). @experimental */
export type InspectControl = 'restart' | 'kill' | 'block';

/**
 * The `inspect` port: isolate → host (ADR 0020, decision 6). Each message with
 * an `id` gets a `result` (`snapshot` gets a `snapshot`) with `re` set to it.
 * - `listen` / `unlisten`: start and stop the feed's `event`, `beats` and
 *   `metrics` messages on the port;
 * - `snapshot`: one `InspectSnapshot`;
 * - `records`: the last `last` records of `topic` (at most 100), as
 *   `InspectRecord`s in the result's `value`;
 * - `tap` / `untap`: copy matching records onto the port as `record`
 *   messages, `untap`'s `re` naming the tap's `id`;
 * - `control`: restart, kill or block (`ms`, at most 10 s) an isolate.
 * @experimental
 */
export type IsolateToInspect =
  | Envelope<'listen', Record<string, never>>
  | Envelope<'unlisten', Record<string, never>>
  | Envelope<'snapshot', Record<string, never>>
  | Envelope<'records', { topic: string; last: number }>
  | Envelope<'tap', { topics: string[]; maxPerSec?: number }>
  | Envelope<'untap', Record<string, never>>
  | Envelope<'control', { action: InspectControl; id: string; ms?: number }>;

/**
 * The `inspect` port: host → isolate. The feed's own messages, a call's
 * `result`, and a tap's `record` and `skipped` (with `re` naming the tap).
 * @experimental
 */
export type InspectToIsolate =
  | InspectMessage
  | Envelope<'result', CallResult>
  | Envelope<'record', InspectRecord>
  | Envelope<'skipped', { count: number }>;

/** @experimental */
export const ISOLATE_TO_INSPECT: MessageTypes<IsolateToInspect> = {
  listen: true,
  unlisten: true,
  snapshot: true,
  records: true,
  tap: true,
  untap: true,
  control: true,
};

/** @experimental */
export const INSPECT_TO_ISOLATE: MessageTypes<InspectToIsolate> = {
  ...INSPECT_MESSAGES,
  result: true,
  record: true,
  skipped: true,
};

/** @experimental */
export const isIsolateToInspect: (x: unknown) => x is IsolateToInspect =
  envelopeGuard(ISOLATE_TO_INSPECT);

/** @experimental */
export const isInspectToIsolate: (x: unknown) => x is InspectToIsolate =
  envelopeGuard(INSPECT_TO_ISOLATE);
