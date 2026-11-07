/** The Web Lock the bus worker holding the origin's OPFS files keeps (ADR 0007, decision 6). */
export const BUS_LOCK = 'isoloop-bus';

/**
 * Takes the `isoloop-bus` Web Lock and holds it until this worker ends, so
 * only one tab writes the files. Resolves whether it got it: at once when
 * `waitMs` is 0, else after up to `waitMs` (a restarting bus waits for the
 * one it replaces to let go). Without Web Locks it reports `true`: opening
 * the files then decides.
 */
export function takeBusLock(waitMs: number): Promise<boolean> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const held = (lock: Lock | null): Promise<void> | undefined => {
      if (!lock) {
        resolve(false);
        return undefined;
      }
      resolve(true);
      // Held for the worker's life: terminating it releases the lock.
      return new Promise<void>(() => {});
    };
    const request =
      waitMs > 0
        ? locks.request(BUS_LOCK, { signal: AbortSignal.timeout(waitMs) }, held)
        : locks.request(BUS_LOCK, { ifAvailable: true }, held);
    // A timed-out wait rejects with the signal's reason.
    request.catch(() => resolve(false));
  });
}
