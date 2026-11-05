import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { CallResult, ErrorPayload } from './errors';
import type { SerializedEvent } from './events';
import type { Grants } from './grants';

/** Why the host asks an isolate to shut down. `suspend` keeps its offsets (M2, ADR 0001). */
export type ShutdownReason = 'stop' | 'restart' | 'suspend';

/** Calls an isolate can make to the host (design §4.7). */
export type HostMethod = 'measure' | 'focus' | 'navigate' | 'scrollIntoView' | 'requestCanvas';

/** What `measure` returns: a node's box relative to its surface, in CSS pixels. */
export type Rect = { x: number; y: number; width: number; height: number };

/** First message to an isolate. The host's half of the version handshake. */
export type InitPayload = {
  isolateId: string;
  /** Protocol versions the host accepts. */
  protocol: { min: number; max: number };
  /** `isoloop-dom@1`, `legacy-vdom@1`, or `none` (headless). */
  renderFmt: string;
  /** `manifest.config`, passed through. */
  config: unknown;
  grants: Grants;
  /** Transferred. */
  busPort: MessagePort;
  heartbeatMs: number;
  /** Isolate module URL, imported by the bootstrap. */
  src: string;
};

/** Isolate port: host → isolate. */
export type HostToIsolate =
  | Envelope<'init', InitPayload>
  | Envelope<'event', SerializedEvent>
  | Envelope<'result', CallResult>
  | Envelope<'shutdown', { reason: ShutdownReason; graceMs: number }>
  /** New bus port after a bus restart (ADR 0007). */
  | Envelope<'reattach', { busPort: MessagePort }>;

/** Isolate port: isolate → host. */
export type IsolateToHost =
  /** The isolate's half of the handshake: what it actually runs. */
  | Envelope<'ready', { runtime: string; adapter: string; renderFmt: string }>
  | Envelope<'patch', { fmt: string; batch: unknown }>
  | Envelope<'call', { method: HostMethod; args: unknown[] }>
  | Envelope<'beat', { lagMs: number; heapBytes?: number }>
  | Envelope<'error', ErrorPayload>
  /** Last message after `shutdown`: handlers ran, the host may terminate now (design §7.6). */
  | Envelope<'bye', Record<string, never>>;

export const HOST_TO_ISOLATE: MessageTypes<HostToIsolate> = {
  init: true,
  event: true,
  result: true,
  shutdown: true,
  reattach: true,
};

export const ISOLATE_TO_HOST: MessageTypes<IsolateToHost> = {
  ready: true,
  patch: true,
  call: true,
  beat: true,
  error: true,
  bye: true,
};

export const isHostToIsolate: (x: unknown) => x is HostToIsolate =
  envelopeGuard<HostToIsolate>(HOST_TO_ISOLATE);

export const isIsolateToHost: (x: unknown) => x is IsolateToHost =
  envelopeGuard<IsolateToHost>(ISOLATE_TO_HOST);
