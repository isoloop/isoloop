import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';
import type { ErrorCode, ErrorPayload } from './errors';
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

/** Sampled every second on the control port (design §6.3). */
export type BusMetrics = {
  topics: { topic: string; recordsPerSec: number; bytesPerSec: number }[];
  /** `lag` is `head − cursor`. */
  subscriptions: { consumer: string; topic: string; lag: number; credit: number }[];
  rejected: Partial<Record<ErrorCode, number>>;
};

/** Control port: host → bus worker. */
export type HostToBus =
  | Envelope<'boot', { contractsUrl: string; topics: TopicConfig[] }>
  | Envelope<'attach', { isolateId: string; grants: Grants; port: MessagePort }>
  | Envelope<'detach', { isolateId: string; keepOffsets: boolean }>
  | Envelope<'publish', { topic: string; key?: string; value: unknown }>;

/** Control port: bus worker → host. */
export type BusToHost =
  | Envelope<
      'ready',
      { engine: string; storage: 'memory' | 'opfs'; restored: { topic: string; head: number }[] }
    >
  | Envelope<'beat', { lagMs: number }>
  /** A record arrived for a suspended isolate (ADR 0001). */
  | Envelope<'wake', { isolateId: string; topic: string }>
  | Envelope<'metrics', BusMetrics>
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
  error: true,
};

export const isHostToBus: (x: unknown) => x is HostToBus = envelopeGuard<HostToBus>(HOST_TO_BUS);

export const isBusToHost: (x: unknown) => x is BusToHost = envelopeGuard<BusToHost>(BUS_TO_HOST);
