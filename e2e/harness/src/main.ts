// Exposes the kernel to Playwright: tests drive it through page.evaluate.
import busWorker from '@isoloop/bus/worker?worker&url';
import { createKernel, type Kernel, type KernelConfig } from '@isoloop/host';
import worker from '@isoloop/runtime/worker?worker&url';

// The tiny worker entry, marked as @isoloop/vite's virtual:isoloop/workers marks
// it, so each worker starts from a URL of its own (memory per isolate, ADR 0020).
const bootstrap = `${worker}#isoloop-entry`;

type Config = Omit<KernelConfig, 'workers' | 'contracts'> & { budget?: number };

export type Harness = {
  createKernel(config?: Config): Kernel;
  /**
   * A kernel with a bus worker. The contracts module at `contractsUrl` is
   * imported here for `contracts.list` and by the bus worker, as in an app.
   */
  createBusKernel(contractsUrl: string, config?: Config): Promise<Kernel>;
  /** `connectDevMCP` from `@isoloop/host/dev-mcp` (M4a), loaded on first use. */
  connectDevMCP(kernel: Kernel, options: { token: string; url?: string }): Promise<() => void>;
};

declare global {
  interface Window {
    harness: Harness;
  }
}

type List = NonNullable<KernelConfig['contracts']>['list'];

/** A module whose default export looks like a contracts() list; the bus worker checks the rest. */
const hasList = (mod: unknown): mod is { default: List } => {
  if (typeof mod !== 'object' || mod === null || !('default' in mod)) return false;
  const list: unknown = mod.default;
  return (
    typeof list === 'object' && list !== null && 'topics' in list && Array.isArray(list.topics)
  );
};

const workers = (budget: number | undefined): KernelConfig['workers'] => ({
  isolateBootstrap: bootstrap,
  ...(budget === undefined ? {} : { budget }),
});

window.harness = {
  createKernel: ({ budget, ...config } = {}) =>
    createKernel({ ...config, workers: workers(budget) }),
  async createBusKernel(contractsUrl, { budget, ...config } = {}) {
    const mod: unknown = await import(/* @vite-ignore */ contractsUrl);
    if (!hasList(mod)) throw new Error(`${contractsUrl} has no contracts() default export`);
    return createKernel({
      ...config,
      contracts: { url: contractsUrl, list: mod.default },
      workers: { ...workers(budget), bus: busWorker },
    });
  },
  async connectDevMCP(kernel, options) {
    const { connectDevMCP } = await import('@isoloop/host/dev-mcp');
    return connectDevMCP(kernel, options);
  },
};
document.body.dataset['ready'] = 'true';
