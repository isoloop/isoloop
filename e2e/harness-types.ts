/// <reference lib="dom" />
// The slice of the kernel the E2E tests use, from e2e/harness/src/main.ts's
// window.harness and four-loops' window.kernel, typed here so the Node-side
// tests don't depend on @isoloop/host. The callbacks passed to page.evaluate
// run in the page.
type HarnessKernel = {
  spawn(m: {
    id: string;
    src: string;
    surface?: Element;
    pool?: string;
    config?: unknown;
  }): unknown;
  on(event: 'isolate:ready', fn: (e: { id: string }) => void): () => void;
  on(
    event: 'isolate:crash',
    fn: (e: { id: string; reason: string; message: string }) => void,
  ): () => void;
  on(
    event: 'isolate:state',
    fn: (e: { id: string; state: string; prev: string }) => void,
  ): () => void;
  on(
    event: 'bus:publish',
    fn: (e: { from: string; topic: string; value: unknown }) => void,
  ): () => void;
  isolates(): {
    id: string;
    state: string;
    restarts: number;
    surface?: { queued: number; applied: number };
  }[];
  destroy(): Promise<void>;
};
declare global {
  interface Window {
    harness: {
      createKernel(config?: {
        supervisor?: { strategy?: 'one-for-one' | 'never' };
        heartbeat?: { blockedAfterMs?: number; killAfterMs?: number };
        budget?: number;
      }): HarnessKernel;
    };
    /** four-loops' kernel (examples/four-loops/src/main.ts). */
    kernel: HarnessKernel;
  }
}

export type { HarnessKernel };
