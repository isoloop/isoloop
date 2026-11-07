// The bench page: a kernel factory and the isolate URLs, for the Playwright script.
import { createKernel, type Kernel } from '@isoloop/host';
import isolates from 'virtual:isoloop/isolates';
import workers from 'virtual:isoloop/workers';

declare global {
  interface Window {
    bench: { createKernel(): Kernel; isolates: Record<string, string> };
  }
}

window.bench = { createKernel: () => createKernel({ workers }), isolates };
document.body.dataset['ready'] = String(crossOriginIsolated);
