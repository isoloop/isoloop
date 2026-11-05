/// <reference lib="dom" />
// The slice of e2e/harness/src/main.ts's window.harness these tests use,
// typed here so the Node-side tests don't depend on @isoloop/host. The
// callbacks passed to page.evaluate run in the page.
type HarnessKernel = {
  spawn(m: { id: string; src: string; surface?: Element; pool?: string }): unknown;
  on(event: 'isolate:ready', fn: (e: { id: string }) => void): () => void;
  on(
    event: 'isolate:crash',
    fn: (e: { id: string; reason: string; message: string }) => void,
  ): () => void;
  isolates(): { id: string; state: string }[];
  destroy(): Promise<void>;
};
declare global {
  interface Window {
    harness: {
      createKernel(config?: {
        supervisor?: { strategy?: 'one-for-one' | 'never' };
        budget?: number;
      }): HarnessKernel;
    };
  }
}

export type { HarnessKernel };
