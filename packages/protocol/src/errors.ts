/** Every error code on the wire (design §3, §4.7, §6.1, §6.3; ADRs 0002, 0003, 0007, 0008). */
export const ERROR_CODES = [
  // Handshake
  'protocol_mismatch',
  // Host calls
  'timeout',
  'no_surface',
  'forbidden',
  /** The node id names no rendered node (it was removed, or never existed). */
  'not_found',
  /** The method isn't one this host knows. */
  'unsupported',
  // Routing (ADR 0002)
  'cross_origin',
  'routing_disabled',
  'navigate_failed',
  // Broker
  'unknown_topic',
  'too_large',
  'invalid',
  'not_encodable',
  /** The origin's storage is full: persistent publishes reject, memory topics carry on (M2b). */
  'quota_exceeded',
  'bus_unavailable',
  'not_requestable',
  'already_replied',
  'reply_invalid',
  // Contracts (ADR 0003): fatal, never retried
  'contracts_failed',
  'contracts_invalid',
  'contracts_mismatch',
  'reserved_topic',
  // Seeding (M2b)
  'seed_async',
  'seed_pending',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const codes: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === 'string' && codes.has(x);
}

/** A schema issue, as reported with `invalid` (design §6.3). */
export type Issue = { message: string; path: (string | number)[] };

export type CallError = { code: ErrorCode; message: string; issues?: Issue[] };

/** Reply to a host call or an acknowledged publish. */
export type CallResult = { ok: true; value: unknown } | { ok: false; error: CallError };

/** Payload of an `error` envelope from an isolate or the bus worker. */
export type ErrorPayload = { message: string; stack?: string; fatal: boolean; code?: ErrorCode };
