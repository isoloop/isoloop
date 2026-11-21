import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { CallResult, ErrorCode, ErrorPayload, Issue } from '../errors/errors';
import type { PublishId, RecordReq, RequestVia } from './bus';
import type { Grants } from '../topics/grants';

/**
 * What a topic's log keeps: `last-n`, the newest `n` records; `time`, the
 * records younger than `ms` by their `ts`; `compacted`, the latest record per
 * key.
 */
export type Retention =
  | {
      kind: 'last-n';
      /** How many records to keep, a positive integer. */
      n: number;
    }
  | {
      kind: 'time';
      /** How long to keep a record, in milliseconds, a positive integer. */
      ms: number;
    }
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

/** Why persistent topics run in memory (`bus:durability_degraded`). */
export type DurabilityDegraded = 'another_tab' | 'no_sync_access' | 'open_failed';

/**
 * Seeding news (ADR 0003, decision 18). `rejected`: a source record `map`
 * threw on, returned a promise for (`seed_async`), or the topic's schema
 * rejected; it was skipped and stays in `from`. `seeded`: the seed ended and
 * the topic opened.
 */
export type SeedEvent =
  | {
      kind: 'rejected';
      topic: string;
      from: string;
      offset: number;
      code: ErrorCode;
      issues: Issue[];
    }
  | { kind: 'seeded'; topic: string; copied: number; rejected: number };

/** The bus's figures, sampled every second: `bus:metrics`. */
export type BusMetrics = {
  /**
   * Per topic: records and bytes a second; `head`, the next offset to be
   * written; and `retained`, how many records the topic still holds.
   */
  topics: {
    topic: string;
    recordsPerSec: number;
    bytesPerSec: number;
    head: number;
    retained: number;
  }[];
  /**
   * Per consumer and topic: `lag` is `head − cursor`; `credit` is how many
   * records may still be delivered before its next commit.
   */
  subscriptions: { consumer: string; topic: string; lag: number; credit: number }[];
  /** Rejected publishes by error code, since the bus worker started. */
  rejected: Partial<Record<ErrorCode, number>>;
  /** The origin's storage use, from `navigator.storage.estimate()`, while the bus keeps files. */
  storage?: { usage: number; quota: number };
};

/** Longest preview of a record's value, in characters (ADR 0020, decision 3). */
export const PREVIEW_CHARS = 2048;

/** Records a `tap` sends each second when its `maxPerSec` isn't given. */
export const DEFAULT_TAP_PER_SEC = 50;

/** Most records one `read` returns. */
export const MAX_READ = 100;

/**
 * A record as the inspection feed shows it: its value as text, cut to 2,048
 * characters, with the value's estimated size in bytes.
 * @experimental
 */
export type RecordPreview = {
  /** The topic's name. */
  topic: string;
  /** Its place in the topic's log. */
  offset: number;
  /** The key it was published with, if any. */
  key?: string;
  /** `Date.now()` at append. */
  ts: number;
  /** Who published it: an isolate's id, or the host. */
  producer: string;
  /** For a request record: who asked, and the request's id. */
  req?: RecordReq;
  /** The value's estimated size, as the bus counts it for `too_large` and the byte rates. */
  bytes: number;
  /** The value as JSON-like text, at most 2,048 characters. */
  preview: string;
  /** `preview` was cut short. */
  truncated: boolean;
};

/**
 * A tap's port: bus → host. `skipped` counts the records over the tap's
 * `maxPerSec` since the last `skipped`, sent at most once a second.
 * @experimental
 */
export type BusToTap = Envelope<'record', RecordPreview> | Envelope<'skipped', { count: number }>;

/** A tap's port: host → bus. `close` ends the tap. @experimental */
export type TapToBus = Envelope<'close', Record<string, never>>;

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
  /**
   * `kernel.publish`. With `id` set, the bus replies with `result`. The host
   * is the producer for `epoch` and `seq` (ADR 0007, step 6).
   */
  | Envelope<'publish', { topic: string; key?: string; value: unknown } & PublishId>
  /**
   * `kernel.request` (ADR 0018, decision 4): appended like a host publish,
   * with `req: { from: 'host', id, via }` on the record. `id` is required
   * and is the request id; the reply (or a failure) comes back as `result`.
   * The broker forgets the request after `timeoutMs`; the host raises the
   * timeout.
   */
  | Envelope<
      'request',
      {
        topic: string;
        key?: string;
        value: unknown;
        timeoutMs: number;
        via?: RequestVia;
      } & PublishId
    >
  /**
   * The page is freezing or going away: write persistent topics' pending
   * batch now (ADR 0001, what the browser still controls). With `id` set, the
   * bus replies with `result` once it is on disk.
   */
  | Envelope<'flush', Record<string, never>>
  /**
   * `kernel.dropTopic`: deletes a persistent topic the contracts no longer
   * list (ADR 0003, decision 19). The bus replies with `result`.
   */
  | Envelope<'drop', { topic: string; force: boolean }>
  /**
   * The inspection feed's tap (ADR 0020, decision 3): the bus copies each
   * record appended to a topic matching `topics` onto `port` as a
   * `RecordPreview`, at most `maxPerSec` a second (default 50), and counts
   * the rest as skipped. A tap is not a consumer: no cursor, no credit, no
   * commits, and no row in `BusMetrics.subscriptions`. It ends with `close`
   * on its port, or with the bus worker.
   */
  | Envelope<'tap', { topics: string[]; maxPerSec?: number; port: MessagePort }>
  /**
   * The inspection feed's read (ADR 0020, decision 3): the last `last`
   * retained records of `topic` (at most 100), oldest first, as
   * `RecordPreview`s in a `result`.
   */
  | Envelope<'read', { topic: string; last: number }>;

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
        /**
         * Persistent topics on disk that the contracts no longer list: kept,
         * not opened (ADR 0003, decision 19). `bytes` is their total size.
         */
        orphaned?: { names: string[]; bytes: number };
      }
    >
  | Envelope<'beat', { lagMs: number }>
  /** A record arrived for a suspended isolate (ADR 0001). */
  | Envelope<'wake', { isolateId: string; topic: string }>
  | Envelope<'metrics', BusMetrics>
  /** Answers a host `publish` sent with an `id`. */
  | Envelope<'result', CallResult>
  | Envelope<'seed', SeedEvent>
  /** `fatal` with a contracts `code` means the bus can't start; the host doesn't retry it (ADR 0003). */
  | Envelope<'error', ErrorPayload>;

export const HOST_TO_BUS: MessageTypes<HostToBus> = {
  boot: true,
  attach: true,
  detach: true,
  publish: true,
  request: true,
  flush: true,
  drop: true,
  tap: true,
  read: true,
};

/** The message types a tap's port carries from the bus (ADR 0020, decision 3). @experimental */
export const BUS_TO_TAP: MessageTypes<BusToTap> = { record: true, skipped: true };

/** The message types a tap's port carries to the bus. @experimental */
export const TAP_TO_BUS: MessageTypes<TapToBus> = { close: true };

export const BUS_TO_HOST: MessageTypes<BusToHost> = {
  ready: true,
  beat: true,
  wake: true,
  metrics: true,
  result: true,
  seed: true,
  error: true,
};

export const isHostToBus: (x: unknown) => x is HostToBus = envelopeGuard<HostToBus>(HOST_TO_BUS);

export const isBusToHost: (x: unknown) => x is BusToHost = envelopeGuard<BusToHost>(BUS_TO_HOST);

/** A well-formed message from the bus on a tap's port. @experimental */
export const isBusToTap: (x: unknown) => x is BusToTap = envelopeGuard<BusToTap>(BUS_TO_TAP);

/** A well-formed message from the host on a tap's port. @experimental */
export const isTapToBus: (x: unknown) => x is TapToBus = envelopeGuard<TapToBus>(TAP_TO_BUS);
