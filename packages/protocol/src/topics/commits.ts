/*
 * Combined commits (ADR 0016, decision 1). One port's subscribers tell the
 * broker how far they got in one `commits` message per commit interval,
 * instead of one `commit` per record. Shared by the isolate's bus client and
 * the host's own subscriptions, so both sides follow the same rules.
 *
 * Each entry carries the highest settled offset and the highest delivery
 * `seq` settled whole, with every delivery before it (ADR 0016, points
 * 10–12): the broker covers a group member's records only up to both, so a
 * record redelivered after the commit's deliveries stays uncovered. When the
 * next delivery is partly settled, `partial` counts its settled records, in
 * the order they arrived (point 17), so a member that stops partway through
 * a delivery keeps what it settled.
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

/**
 * Where one subscription has settled to: the highest settled offset, the
 * delivery `seq` settled whole (ADR 0016, point 11), and how many records of
 * delivery `seq + 1` are settled, when some are (point 17).
 */
export type CommitPoint = { offset: number; seq: number; partial?: number };

export type CommitOffsets = ({ topic: string } & CommitPoint)[];

/**
 * The commit point each record of one `deliver` settles to, in order. A
 * record settles its delivery `seq` only as the delivery's last record, and
 * `seq − 1` before that: a delivery counts once all its records are settled,
 * and records settle in the order they arrived. Before the last, the `i`-th
 * record also settles the first `i + 1` records of its delivery (`partial`,
 * ADR 0016, point 17). Its offset is the highest
 * delivered on the subscription up to it, `highest` being the highest before
 * this delivery (`-1` for none), so a commit that counts a delivery settled
 * also reaches every offset in it.
 */
export function deliveryPoints(
  seq: number,
  offsets: readonly number[],
  highest: number,
): CommitPoint[] {
  let top = highest;
  return offsets.map((offset, i) => {
    top = Math.max(top, offset);
    return i === offsets.length - 1
      ? { offset: top, seq }
      : { offset: top, seq: seq - 1, partial: i + 1 };
  });
}

export type CommitterOptions = {
  /** Sends one `commits` message. Called with at least one entry. */
  send: (offsets: CommitOffsets) => void;
  /** 0: at the end of each task that settled a record. Default 100. */
  intervalMs?: number;
  /** The broker's credit per subscription; a subscription sends early at half of it. Default 1,000. */
  credit?: number;
};

export type Committer = {
  /**
   * `records` records of `topic` are settled (default one): everything up to
   * `at.offset`, and every delivery up to `at.seq` whole. Each is kept as the
   * highest seen, separately: a record redelivered to a group member can
   * have a lower offset than records it settled before (ADR 0016, point 11).
   */
  settle(topic: string, at: CommitPoint, records?: number): void;
  /** Sends what's pending now: an unsubscribe, and a new port after a bus restart. */
  flush(): void;
  /**
   * Returns what's pending and clears it, without sending: for a sender that
   * must wait for the broker's answer (a shutdown, before `bye`).
   */
  take(): CommitOffsets | undefined;
  /** Forgets a topic's pending offset (an unsubscribe or a lost memory topic). */
  drop(topic: string): void;
  /** Settled points not yet sent, by topic. For tests and reports. */
  pending(): ReadonlyMap<string, CommitPoint>;
  /** Stops the timer without sending. */
  dispose(): void;
};

const point = ({ offset, seq, partial }: CommitPoint): CommitPoint =>
  partial ? { offset, seq, partial } : { offset, seq };

/**
 * The further of two commit points: the highest offset, and the delivery
 * reached furthest, a whole delivery being further than any part of it.
 */
function later(a: CommitPoint, b: CommitPoint): CommitPoint {
  const offset = Math.max(a.offset, b.offset);
  const reach = (p: CommitPoint): [number, number] => [p.seq, p.partial ?? 0];
  const [as, ap] = reach(a);
  const [bs, bp] = reach(b);
  const far = bs > as || (bs === as && bp >= ap) ? b : a;
  return point({ ...far, offset });
}

export function createCommitter(o: CommitterOptions): Committer {
  const intervalMs = o.intervalMs ?? DEFAULT_COMMIT_INTERVAL_MS;
  const half = Math.max(1, Math.floor((o.credit ?? DEFAULT_CREDIT) / 2));
  /** Highest settled offset and delivery per topic, not yet sent. */
  const offsets = new Map<string, CommitPoint>();
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
    for (const [topic, { offset, seq, partial }] of offsets)
      out.push(partial ? { topic, offset, seq, partial } : { topic, offset, seq });
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
    settle(topic, at, records = 1) {
      const prev = offsets.get(topic);
      offsets.set(topic, prev === undefined ? point(at) : later(prev, at));
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
