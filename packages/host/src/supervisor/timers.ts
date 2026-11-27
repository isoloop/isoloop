/*
 * The two clocks of a restart policy (design §4.1, §4.3): a sliding window
 * that counts recent restarts, and exponential backoff between them. Pure, so
 * tests drive them with plain numbers.
 */

/**
 * The wait before each restart in the restart window: `initialMs × factorⁿ`,
 * capped at `maxMs`, where n is the number of restarts already in the window.
 */
export type Backoff = {
  /** Delay before the first restart in a window, in ms. Default 250. */
  initialMs: number;
  /** Growth per restart already in the window. Default 2. */
  factor: number;
  /** The longest delay, in ms. Default 4 000 (4 s). */
  maxMs: number;
};

export const DEFAULT_BACKOFF: Backoff = { initialMs: 250, factor: 2, maxMs: 4000 };

/** `initialMs × factorⁿ`, capped, where n is the number of restarts already in the window. */
export function backoffMs(n: number, b: Backoff): number {
  return Math.min(b.maxMs, b.initialMs * b.factor ** n);
}

/** The restart times still inside `[at - withinMs, at]`, oldest first. */
export function slide(times: readonly number[], at: number, withinMs: number): number[] {
  return times.filter((t) => at - t < withinMs);
}

/**
 * The host's lateness (ADR 0001, *Heartbeat clock: the host's lag*): how
 * long the supervision tick, due every `everyMs`, fired late, summed. On a
 * CPU-starved page the main thread can't hear beats while it waits for a
 * CPU, so the kill and ready timers leave this time out.
 */
export type HostLag = {
  /** The tick ran at `at`; adds how late it was. */
  tick(at: number): void;
  /** The total so far, in ms. */
  total(): number;
};

export function createHostLag(everyMs: number, startAt: number): HostLag {
  let prev = startAt;
  let sum = 0;
  return {
    tick(at) {
      sum += Math.max(0, at - prev - everyMs);
      prev = at;
    },
    total: () => sum,
  };
}
