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
    grants?: { publish: string[]; subscribe: string[]; navigate?: boolean };
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
  on(event: 'bus:ready', fn: (e: { first: boolean }) => void): () => void;
  on(
    event: 'route:navigate_error',
    fn: (e: { from: string; href: string; error: string }) => void,
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
  syncRoute(): void;
  debug: { crashBus(): void };
  destroy(): Promise<void>;
};

type HarnessConfig = {
  supervisor?: { strategy?: 'one-for-one' | 'never' };
  heartbeat?: { blockedAfterMs?: number; killAfterMs?: number };
  budget?: number;
  routing?: boolean;
  basePath?: string;
  onNavigate?: (req: {
    href: string;
    replace: boolean;
    state?: unknown;
    from: string;
  }) => boolean | Promise<boolean>;
};
declare global {
  interface Window {
    harness: {
      createKernel(config?: HarnessConfig): HarnessKernel;
      createBusKernel(contractsUrl: string, config?: HarnessConfig): Promise<HarnessKernel>;
    };
    /** four-loops' kernel (examples/four-loops/src/main.ts). */
    kernel: HarnessKernel;
  }
}

export type { HarnessKernel };
