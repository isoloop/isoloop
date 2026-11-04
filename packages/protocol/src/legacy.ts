import { envelopeGuard, type Envelope, type MessageTypes } from './envelope';

/*
 * M0 only, removed in M2 (plan m0-foundations, task 5). Until the bus worker
 * exists, bus traffic goes over the isolate port through the main thread, as in
 * the proof of concept. Internal: not part of the v1 protocol.
 */

/** @internal Isolate port, isolate → host: publish on the main-thread bus. */
export type XPub = Envelope<'x-pub', { topic: string; value: unknown }>;
/** @internal Isolate port, isolate → host: subscribe on the main-thread bus. */
export type XSub = Envelope<'x-sub', { topic: string }>;
/** @internal Isolate port, host → isolate: a record from another isolate. */
export type XDeliver = Envelope<'x-deliver', { topic: string; value: unknown; from: string }>;

/** @internal */
export type LegacyIsolateToHost = XPub | XSub;
/** @internal */
export type LegacyHostToIsolate = XDeliver;

/** @internal */
export const LEGACY_ISOLATE_TO_HOST: MessageTypes<LegacyIsolateToHost> = {
  'x-pub': true,
  'x-sub': true,
};
/** @internal */
export const LEGACY_HOST_TO_ISOLATE: MessageTypes<LegacyHostToIsolate> = { 'x-deliver': true };

/** @internal */
export const isLegacyIsolateToHost: (x: unknown) => x is LegacyIsolateToHost =
  envelopeGuard<LegacyIsolateToHost>(LEGACY_ISOLATE_TO_HOST);
/** @internal */
export const isLegacyHostToIsolate: (x: unknown) => x is LegacyHostToIsolate =
  envelopeGuard<LegacyHostToIsolate>(LEGACY_HOST_TO_ISOLATE);
