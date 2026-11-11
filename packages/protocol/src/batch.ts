/*
 * Batching per port per task (ADR 0016, decision 3), an experimental opt-in
 * behind `KernelConfig.bus.batch`, off by default.
 *
 * - Every receiver on a bus port always accepts a `batch` and handles its
 *   inner envelopes in order, as if they had arrived one by one: `unbatch`.
 * - A sender batches only when the setting is on: it queues envelopes and
 *   sends them at the end of the current task, from microtasks (it waits a
 *   few hops while microtasks queued after its own still add to it, never a
 *   task); one envelope goes as itself, two or more as one `batch`. Off, every envelope goes out
 *   at once, as before: nothing changes on the wire.
 *
 * `batch` is a wrapper on the port, not one of its message types: the
 * per-port guards (`isIsolateToBus`, `isBusToIsolate`) check each inner
 * envelope, and a `batch` inside a `batch` is dropped like any unknown type.
 */
import { isEnvelope, type AnyEnvelope, type Envelope } from './envelope';

/** Several envelopes sent in one task, as one message (ADR 0016, decision 3). */
export type Batch<E extends AnyEnvelope = AnyEnvelope> = Envelope<'batch', { msgs: E[] }>;

/** True for a well-formed `batch` envelope. Its inner envelopes are not checked here. */
export function isBatch(x: unknown): x is Batch {
  if (!isEnvelope(x) || x.t !== 'batch') return false;
  const p: unknown = x.p;
  return typeof p === 'object' && p !== null && Array.isArray((p as { msgs?: unknown }).msgs);
}

/**
 * Calls `handle` for each envelope a port message carries: a batch's inner
 * envelopes in order, or the message itself. Receivers call it whatever their
 * own setting, so a batching sender and a non-batching receiver always agree.
 */
export function unbatch(data: unknown, handle: (msg: unknown) => void): void {
  if (!isBatch(data)) {
    handle(data);
    return;
  }
  for (const msg of data.p.msgs) handle(msg);
}

/** Microtask hops a flush waits at most while its queue still grows. */
const MAX_HOPS = 8;

export type BatchSender<E extends AnyEnvelope> = {
  /** Sends at once when batching is off; queues for the end of the task when it's on. */
  send(msg: E): void;
  /** Sends what's queued now: before a port closes, or to keep order with a send that can't wait. */
  flush(): void;
  /** Drops what's queued without sending it: the port it was meant for is gone. */
  clear(): void;
  /** Envelopes queued and not sent yet. For tests. */
  queued(): number;
};

/**
 * A sender for one port. `on` is read on every send, so a sender created
 * before its setting is known (a port held while the bus boots) picks it up.
 * Turning it off flushes what's queued first, so order is kept.
 */
export function createBatchSender<E extends AnyEnvelope>(
  post: (msg: E | Batch<E>) => void,
  on: () => boolean,
): BatchSender<E> {
  let queue: E[] = [];
  let scheduled = false;
  /** Queue length at the last microtask hop, and hops taken. */
  let seen = 0;
  let hops = 0;
  // The end of the task, from microtasks: while the queue still grows from
  // microtasks queued after ours (a commit settled after a handler's
  // publish, a promise continuation), wait one more hop, up to MAX_HOPS.
  // It never waits for another task.
  const hop = (): void => {
    if (queue.length > seen && hops < MAX_HOPS) {
      seen = queue.length;
      hops++;
      queueMicrotask(hop);
      return;
    }
    flush();
  };
  const flush = (): void => {
    scheduled = false;
    seen = 0;
    hops = 0;
    if (queue.length === 0) return;
    const msgs = queue;
    queue = [];
    const [only] = msgs;
    post(msgs.length === 1 && only !== undefined ? only : { v: 1, t: 'batch', p: { msgs } });
  };
  return {
    send(msg) {
      if (!on()) {
        if (queue.length > 0) flush();
        post(msg);
        return;
      }
      queue.push(msg);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(hop);
      }
    },
    flush,
    clear() {
      queue = [];
    },
    queued: () => queue.length,
  };
}
