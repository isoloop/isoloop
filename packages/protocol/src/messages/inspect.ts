// The inspection feed's messages (ADR 0020, decisions 1, 2, 5 and 7). Every
// reader gets the same plain, structured-cloneable messages: an `Inspector`
// on the host, an isolate holding the `inspect` grant over its port, and the
// dev MCP over its WebSocket. The format only grows: readers ignore fields and
// message types they don't know, so a reader built apart keeps working
// against a newer kernel.

import type { BusMetrics, RecordPreview } from './control';
import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { CallResult } from '../errors/errors';
import type { Grants } from '../topics/grants';

/**
 * One isolate in the feed, as `kernel.isolates()` has it.
 * `state` and `reason` are the kernel's `IsolateState` and `CrashReason`,
 * typed as strings here so a reader built against an older list still reads
 * a newer kernel's values.
 * @experimental
 */
export type InspectIsolate = {
  /** The isolate's id. */
  id: string;
  /** Its `IsolateState`. */
  state: string;
  /** The pool it runs in; absent for a worker of its own. */
  pool?: string;
  /** `performance.now()` on the host when its last beat arrived. */
  lastBeatAt: number;
  /** How late its worker's last beat fired, past the heartbeat interval, in ms. */
  lagMs: number;
  /** Restarts after a crash since it was spawned. */
  restarts: number;
  /** The last crash's `CrashReason`, while restarting or failed. */
  reason?: string;
  /** The last crash's message, while restarting or failed. */
  error?: string;
  /** Compositor figures for a visual isolate (`SurfaceStats`). */
  surface?: {
    queued: number;
    applied: number;
    rejected: number;
    dropped: number;
    lastFrameMs: number;
  };
  /** Messages from its worker dropped because their version or type was unknown. */
  dropped: number;
  /** Open `ctx.keepAwake()` holds, from the last beat. */
  holds?: { ageMs: number; stack?: string }[];
  /** Milliseconds its worker spent running its code during the last beat's interval. */
  busyMs?: number;
  /**
   * Its worker's memory, from the host's last measurement. Absent when the page isn't cross-origin isolated, in engines without
   * `performance.measureUserAgentSpecificMemory()` (Firefox, Safari), and
   * before the first measurement.
   */
  memory?: InspectMemory;
};

/**
 * One isolate's memory: the bytes the browser attributes to its worker. Coarse, and seconds old: Chromium answers a
 * measurement at its next garbage collection. A reader shows its age and
 * labels it "Chromium, cross-origin isolated".
 * @experimental
 */
export type InspectMemory = {
  /** The bytes the browser attributes to the worker. */
  bytes: number;
  /** `performance.now()` on the host when the measurement came back. */
  at: number;
  /** True for a pool member: the figure is the whole pool's worker, shared by every member. */
  shared?: true;
};

/** One pool in the feed, as `kernel.pools()` has it. @experimental */
export type InspectPool = {
  /** The pool's name. */
  name: string;
  /** Isolates naming this pool, not stopped, in spawn order. */
  members: string[];
  /** True while the pool's worker runs. */
  running: boolean;
  /** The union of its members' grants: what the pool can do in effect. */
  grants: Grants;
  /** True when a member has a surface: the visual members share one document. */
  sharesDocument: boolean;
  /** When `sharesDocument`: what that means for the members, in a sentence for people. */
  warning?: string;
};

/**
 * One kernel event, at once or from the ring buffer. `event` is a `KernelEvents` name (`isolate:crash`, `bus:restart`, …)
 * and `data` its payload. Beats and bus metrics come as their own messages.
 * @experimental
 */
export type InspectEvent = {
  /** `performance.now()` on the host when it happened. */
  at: number;
  /** The event's name, a `KernelEvents` key. */
  event: string;
  /** The event's data, as `kernel.on` gives it. */
  data: Record<string, unknown>;
};

/** One isolate's latest beat in a `beats` message. @experimental */
export type InspectBeat = {
  /** The isolate's id. */
  id: string;
  /** Its pool, when it's a pool member. */
  pool?: string;
  /** How late its worker's beat fired, past the heartbeat interval, in ms. */
  lagMs: number;
  /** Milliseconds its worker spent running its code during the beat's interval. */
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
  /** The bus supervisor's state, or `none`. */
  state: string;
  /** Bus restarts since the kernel started. */
  restarts: number;
  /** The last `bus:metrics`, once one has arrived. */
  metrics?: BusMetrics;
};

/** What a reader gets first: the feed's state at one moment. @experimental */
export type InspectSnapshot = {
  /** `performance.now()` on the host when it was taken. */
  at: number;
  /** Every isolate not stopped. */
  isolates: InspectIsolate[];
  /** The named pools that have members. */
  pools: InspectPool[];
  /** The bus. */
  bus: InspectBus;
  /** The ring buffer: the last 200 events since the kernel started, oldest first. */
  events: InspectEvent[];
};

/**
 * The feed's messages, each `{ v, t, p }`: `t` names it and `p` carries it.
 * - `snapshot`, on request: an isolate's `ctx.inspector.snapshot()` gets it
 *   over its `inspect` port, as the reply to its `snapshot` call;
 * - `event`, a kernel event as it happens;
 * - `beats`, each isolate's latest beat, coalesced to about one a second;
 * - `metrics`, the latest `bus:metrics`, at most one a second;
 * - `memory`, each isolate's memory after a measurement, at most one every
 *   5 s, and only where the page is cross-origin isolated.
 * @experimental
 */
export type InspectMessage =
  | Envelope<'snapshot', InspectSnapshot>
  | Envelope<'event', InspectEvent>
  | Envelope<'beats', { at: number; beats: InspectBeat[] }>
  | Envelope<'metrics', BusMetrics>
  | Envelope<'memory', { at: number; isolates: { id: string; memory: InspectMemory }[] }>;

/** @experimental */
export const INSPECT_MESSAGES: MessageTypes<InspectMessage> = {
  snapshot: true,
  event: true,
  beats: true,
  metrics: true,
  memory: true,
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

/** The shortest time between two memory measurements (ADR 0020, decision 4). */
export const INSPECT_MEMORY_MS = 5_000;

/**
 * One record from a tap or a read: its value cut to a 2 KB preview, with its
 * full size.
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
