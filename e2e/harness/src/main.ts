// Exposes the kernel to Playwright: tests drive it through page.evaluate.
import { createKernel, type Kernel, type KernelConfig } from '@isoloop/host';
import bootstrap from '@isoloop/runtime/bootstrap?worker&url';

export type Harness = {
  createKernel(config?: Omit<KernelConfig, 'workers'> & { budget?: number }): Kernel;
};

declare global {
  interface Window {
    harness: Harness;
  }
}

window.harness = {
  createKernel: ({ budget, ...config } = {}) =>
    createKernel({
      ...config,
      workers: {
        isolateBootstrap: bootstrap,
        ...(budget === undefined ? {} : { budget }),
      },
    }),
};
document.body.dataset['ready'] = 'true';
