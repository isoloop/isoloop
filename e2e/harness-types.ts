/// <reference lib="dom" />
// The slice of the kernel the E2E tests use, from e2e/harness/src/main.ts's
// window.harness and the kernels tests put on window, typed here so the Node-side
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
    fn: (e: { id: string; reason: string; message: string; pool?: string }) => void,
  ): () => void;
  on(
    event: 'isolate:state',
    fn: (e: { id: string; state: string; prev: string }) => void,
  ): () => void;
  on(event: 'isolate:failed', fn: (e: { id: string }) => void): () => void;
  on(event: 'bus:ready', fn: (e: { first: boolean }) => void): () => void;
  on(event: 'bus:durability_degraded', fn: (e: { reason: string }) => void): () => void;
  on(
    event: 'route:navigate_error',
    fn: (e: { from: string; href: string; error: string }) => void,
  ): () => void;
  subscribe(
    topic: { name: string },
    fn: (r: { offset: number; value: unknown; producer: string }) => void,
    opts?: { from?: 'latest' | 'earliest' | 'committed' },
  ): () => void;
  publish(topic: { name: string }, value: unknown, opts?: { key?: string }): Promise<void>;
  request(topic: { name: string }, value: unknown, opts?: { timeoutMs?: number }): Promise<unknown>;
  isolates(): {
    id: string;
    state: string;
    restarts: number;
    lagMs: number;
    pool?: string;
    surface?: { queued: number; applied: number };
    lastBeatAt: number;
    busyMs?: number;
  }[];
  restart(id: string): Promise<void>;
  /** The inspection feed (ADR 0020), as far as the memory E2E reads it. */
  inspect(): {
    on(fn: (m: { t: string }) => void): () => void;
    snapshot(): {
      isolates: {
        id: string;
        state: string;
        memory?: { bytes: number; at: number; shared?: true };
      }[];
    };
    close(): void;
  };
  syncRoute(): void;
  debug: { crashBus(): void; messages(): Record<string, number> };
  destroy(): Promise<void>;
};

type HarnessConfig = {
  supervisor?: { strategy?: 'one-for-one' | 'never'; backoff?: { initialMs?: number } };
  heartbeat?: { everyMs?: number; blockedAfterMs?: number; killAfterMs?: number };
  budget?: number;
  routing?: boolean;
  basePath?: string;
  agents?: { expose: string[]; timeoutMs?: number };
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
      connectDevMCP(
        kernel: HarnessKernel,
        options: { token: string; url?: string },
      ): Promise<() => void>;
      connectWebMCP(kernel: HarnessKernel): Promise<() => void>;
      connectDevtools(
        kernel: HarnessKernel,
        options: { src: string; position?: string },
      ): Promise<() => Promise<void>>;
    };
    /** The kernel a suite created, for later page.evaluate calls (e2e/loops.ts and others). */
    kernel: HarnessKernel;
    /** What `connectWebMCP` returned (e2e/webmcp.spec.ts). */
    disconnectWebMCP?: () => void;
    /** The loops' test hook: main-thread message counts by type (I7, e2e/loops.ts). */
    __isoloop: HarnessKernel['debug'];
    /** The durable suite's kernel and what it saw (e2e/durable.spec.ts). */
    durable?: { kernel: HarnessKernel; degraded: string[] };
  }
}

export type { HarnessKernel };
