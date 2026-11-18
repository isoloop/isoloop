// The inspection feed's messages (ADR 0020, decisions 1, 2, 5 and 7). Every
// reader gets the same plain, structured-cloneable messages: an `Inspector`
// on the host, an isolate holding the `inspect` grant over its port, and the
// dev MCP over its WebSocket. The format only grows: readers ignore fields and
// message types they don't know, so a reader built apart keeps working
// against a newer kernel.

import type { BusMetrics } from './control';
import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { Grants } from './grants';

/**
 * One isolate in the feed, as `kernel.isolates()` has it, plus `heapBytes`.
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
  /**
   * Its worker's JS heap from the last beat, where the engine reports one
   * (Chromium's `performance.memory`). Per worker: pool members share it.
   */
  heapBytes?: number;
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
  heapBytes?: number;
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
 * - `snapshot`, first on an `inspect` port, or on request;
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
