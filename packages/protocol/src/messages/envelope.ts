/** Protocol version this build speaks (`v`) and the oldest it still accepts (`min`). */
export const PROTOCOL = { v: 1, min: 1 } as const;

/** Every message on every port is an envelope. */
export type Envelope<T extends string, P> = {
  /** Protocol version. */
  v: 1;
  /** Message type. */
  t: T;
  /** Set when a reply is expected. */
  id?: string;
  /** Id of the message this replies to. */
  re?: string;
  /**
   * The pool member a message is for (host → worker) or from (worker → host),
   * on a pooled worker's isolate port (M2c, ADR 0001). Absent on an own
   * worker's port, and on messages about the whole worker (`beat`).
   */
  isolate?: string;
  p: P;
};

/** Any envelope, before its type is known. */
export type AnyEnvelope = Envelope<string, unknown>;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isOptionalString = (x: unknown): boolean => x === undefined || typeof x === 'string';

/**
 * True for a well-formed envelope this build can read: `v` is a supported
 * version, `t` is a string, `id`/`re`/`isolate` are absent or strings, and `p`
 * is present.
 * Says nothing about whether `t` is known; see the per-port guards.
 */
export function isEnvelope(x: unknown): x is AnyEnvelope {
  return (
    isRecord(x) &&
    x['v'] === PROTOCOL.v &&
    typeof x['t'] === 'string' &&
    'p' in x &&
    isOptionalString(x['id']) &&
    isOptionalString(x['re']) &&
    isOptionalString(x['isolate'])
  );
}

/**
 * The message types of one port, as a map so the compiler checks that every
 * type in the union is listed: a missing key is a type error.
 */
export type MessageTypes<E extends AnyEnvelope> = Readonly<Record<E['t'], true>>;

/**
 * Builds a guard for one port's union from its message types. Each side drops
 * (and counts) envelopes with an unknown `v` or `t` (design §3), so a guard
 * only checks the envelope and the type, not the payload.
 */
export function envelopeGuard<E extends AnyEnvelope>(
  types: MessageTypes<E>,
): (x: unknown) => x is E {
  return (x: unknown): x is E => isEnvelope(x) && Object.hasOwn(types, x.t);
}

/** Exhaustiveness check for switches over message unions. */
export function assertNever(x: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(x)}`);
}
