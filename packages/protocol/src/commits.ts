/*
 * Combined commits (ADR 0016, decision 1). One port's subscribers tell the
 * broker how far they got in one `commits` message per commit interval,
 * instead of one `commit` per record. Shared by the isolate's bus client and
 * the host's own subscriptions, so both sides follow the same rules.
 */

/** `KernelConfig.bus.commitIntervalMs` when unset (ADR 0016, decision 1, point 7). */
export const DEFAULT_COMMIT_INTERVAL_MS = 100;
/** The highest allowed interval: keeps the redelivery window after a crash under a second. */
export const MAX_COMMIT_INTERVAL_MS = 1000;
/** A subscription's credit at the broker: records delivered and not yet committed. */
export const DEFAULT_CREDIT = 1000;

/** Why an interval is invalid, or `undefined` when it's an integer from 0 to 1,000. */
export function commitIntervalProblem(ms: unknown): string | undefined {
  if (typeof ms === 'number' && Number.isInteger(ms) && ms >= 0 && ms <= MAX_COMMIT_INTERVAL_MS)
    return undefined;
  return `bus.commitIntervalMs must be an integer from 0 to ${MAX_COMMIT_INTERVAL_MS}, got ${String(ms)}`;
}

export type CommitOffsets = { topic: string; offset: number }[];

export type CommitterOptions = {
  /** Sends one `commits` message. Called with at least one entry. */
  send: (offsets: CommitOffsets) => void;
  /** 0: at the end of each task that settled a record. Default 100. */
  intervalMs?: number;
  /** The broker's credit per subscription; a subscription sends early at half of it. Default 1,000. */
  credit?: number;
};

export type Committer = {
  /** `records` records of `topic`, up to `offset`, are settled. Default one. */
  settle(topic: string, offset: number, records?: number): void;
  /** Sends what's pending now: an unsubscribe, and a new port after a bus restart. */
  flush(): void;
  /**
   * Returns what's pending and clears it, without sending: for a sender that
   * must wait for the broker's answer (a shutdown, before `bye`).
   */
  take(): CommitOffsets | undefined;
  /** Forgets a topic's pending offset (an unsubscribe or a lost memory topic). */
  drop(topic: string): void;
  /** Settled offsets not yet sent, by topic. For tests and reports. */
  pending(): ReadonlyMap<string, number>;
  /** Stops the timer without sending. */
  dispose(): void;
};

export function createCommitter(o: CommitterOptions): Committer {
  const intervalMs = o.intervalMs ?? DEFAULT_COMMIT_INTERVAL_MS;
  const half = Math.max(1, Math.floor((o.credit ?? DEFAULT_CREDIT) / 2));
  /** Highest settled offset per topic, not yet sent. */
  const offsets = new Map<string, number>();
  /** Records settled per topic since its last send: the early send at half the credit. */
  const counts = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued = false;

  const take = (): CommitOffsets | undefined => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    queued = false;
    if (offsets.size === 0) return undefined;
    const out: CommitOffsets = [];
    for (const [topic, offset] of offsets) out.push({ topic, offset });
    offsets.clear();
    counts.clear();
    return out;
  };

  const flush = (): void => {
    const out = take();
    if (out) o.send(out);
  };

  const schedule = (): void => {
    if (intervalMs === 0) {
      if (queued) return;
      queued = true;
      // The end of the current task: its microtasks run before the next task.
      queueMicrotask(() => {
        if (queued) flush();
      });
      return;
    }
    timer ??= setTimeout(flush, intervalMs);
  };

  return {
    settle(topic, offset, records = 1) {
      const prev = offsets.get(topic);
      if (prev === undefined || offset > prev) offsets.set(topic, offset);
      const n = (counts.get(topic) ?? 0) + records;
      counts.set(topic, n);
      if (n >= half) flush();
      else schedule();
    },
    flush,
    take,
    drop(topic) {
      offsets.delete(topic);
      counts.delete(topic);
    },
    pending: () => offsets,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      queued = false;
    },
  };
}
