/*
 * The two clocks of a restart policy (design §4.1, §4.3): a sliding window
 * that counts recent restarts, and exponential backoff between them. Pure, so
 * tests drive them with plain numbers.
 */

export type Backoff = {
  /** Delay before the first restart in a window. Default 250 ms. */
  initialMs: number;
  /** Growth per restart already in the window. Default 2. */
  factor: number;
  /** Cap. Default 4 s. */
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
