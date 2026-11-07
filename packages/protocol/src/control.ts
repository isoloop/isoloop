import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { CallResult, ErrorCode, ErrorPayload } from './errors';
import type { Grants } from './grants';

export type Retention =
  | { kind: 'last-n'; n: number }
  | { kind: 'time'; ms: number }
  | { kind: 'compacted' };

/**
 * The structured-cloneable part of a topic definition: what the host sends at
 * `boot` so the bus worker can check it against the contracts module (ADR 0003).
 */
export type TopicConfig = {
  name: string;
  retention: Retention;
  /** Default 256 KiB. */
  maxRecordBytes?: number;
  /** Default `memory`. `persistent` is OPFS (ADR 0007, M2b). */
  durability?: 'memory' | 'persistent';
  /** The topic has a `reply` schema, so `bus.request` works on it. */
  requestable: boolean;
  /** Name of the `seed.from` topic and its `follow` flag (M2b). */
  seed?: { from: string; follow: boolean };
};

/** Why persistent topics run in memory (`bus:durability-degraded`). */
export type DurabilityDegraded = 'another-tab' | 'no-sync-access' | 'open-failed';

/** Sampled every second on the control port (design §6.3). */
export type BusMetrics = {
  topics: { topic: string; recordsPerSec: number; bytesPerSec: number }[];
  /** `lag` is `head − cursor`. */
  subscriptions: { consumer: string; topic: string; lag: number; credit: number }[];
  rejected: Partial<Record<ErrorCode, number>>;
};

/** Control port: host → bus worker. */
export type HostToBus =
  /**
   * `heartbeatMs`: how often the bus sends `beat`, default 100. `dev`: check
   * that schema outputs survive `structuredClone` (ADR 0003, decision 11).
   */
  | Envelope<
      'boot',
      {
        contractsUrl: string;
        topics: TopicConfig[];
        heartbeatMs?: number;
        dev?: boolean;
        /**
         * Safe mode (ADR 0007, decision 5): the bus crashed twice while
         * loading, so it sets each persistent topic's newest segment aside.
         */
        safeMode?: boolean;
        /** A bus restart: the worker it replaces may still hold the files' lock a moment. */
        restart?: boolean;
      }
    >
  /**
   * `reattach`: the isolate was connected to a bus that has since restarted,
   * so each memory topic it subscribes to answers with `reset` first (ADR 0007).
   */
  | Envelope<'attach', { isolateId: string; grants: Grants; port: MessagePort; reattach?: boolean }>
  /**
   * `wake`: the isolate is suspended (ADR 0001). The bus remembers its
   * subscriptions and sends `wake` on the control port when a record arrives
   * on one of them (for a group, only when it was the last member).
   */
  | Envelope<'detach', { isolateId: string; keepOffsets: boolean; wake?: boolean }>
  /** `kernel.publish`. With `id` set, the bus replies with `result`. */
  | Envelope<'publish', { topic: string; key?: string; value: unknown }>;

/** Control port: bus worker → host. */
export type BusToHost =
  | Envelope<
      'ready',
      {
        engine: string;
        storage: 'memory' | 'opfs';
        restored: { topic: string; head: number }[];
        /** Safe mode only: the segments set aside, as `<topic>/<file>`. */
        quarantined?: string[];
        /**
         * Persistent topics run in memory, and why (ADR 0007, decision 6):
         * another tab holds the files, sync access handles are missing, or
         * the files failed to open.
         */
        degraded?: DurabilityDegraded;
      }
    >
  | Envelope<'beat', { lagMs: number }>
  /** A record arrived for a suspended isolate (ADR 0001). */
  | Envelope<'wake', { isolateId: string; topic: string }>
  | Envelope<'metrics', BusMetrics>
  /** Answers a host `publish` sent with an `id`. */
  | Envelope<'result', CallResult>
  /** `fatal` with a contracts `code` means the bus can't start; the host doesn't retry it (ADR 0003). */
  | Envelope<'error', ErrorPayload>;

export const HOST_TO_BUS: MessageTypes<HostToBus> = {
  boot: true,
  attach: true,
  detach: true,
  publish: true,
};

export const BUS_TO_HOST: MessageTypes<BusToHost> = {
  ready: true,
  beat: true,
  wake: true,
  metrics: true,
  result: true,
  error: true,
};

export const isHostToBus: (x: unknown) => x is HostToBus = envelopeGuard<HostToBus>(HOST_TO_BUS);

export const isBusToHost: (x: unknown) => x is BusToHost = envelopeGuard<BusToHost>(BUS_TO_HOST);
