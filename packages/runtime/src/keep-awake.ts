/*
 * `ctx.keepAwake()` (ADR 0001): a hold against suspension. Holds have no time
 * limit; each beat reports their age and creation stack so devtools can list
 * them and dev builds can warn about one held for over 10 minutes.
 */

export type KeepAwake = {
  /** Takes a hold; call the result to release it (twice is harmless). */
  hold(): () => void;
  /** Open holds, oldest first. */
  report(now: number): { ageMs: number; stack?: string }[];
};

export function createKeepAwake(now: () => number = () => performance.now()): KeepAwake {
  const holds = new Map<number, { since: number; stack: string | undefined }>();
  let next = 0;
  return {
    hold() {
      const id = ++next;
      // The caller's frames, without this function's.
      const stack = new Error('keepAwake').stack?.split('\n').slice(2).join('\n');
      holds.set(id, { since: now(), stack });
      return () => {
        holds.delete(id);
      };
    },
    report(at) {
      return [...holds.values()].map((h) =>
        h.stack === undefined ? { ageMs: at - h.since } : { ageMs: at - h.since, stack: h.stack },
      );
    },
  };
}
