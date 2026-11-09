// The memory ladder page: starts one rung, then idles, for the Playwright
// script to measure. One rung per fresh browser.
import { createKernel } from '@isoloop/host';
import { createRoot } from 'react-dom/client';
import isolates from 'virtual:isoloop/isolates';
import workers from 'virtual:isoloop/workers';
import PlainWorker from './plain-worker.ts?worker';
import { Table } from './table';

type Rung = {
  kind: 'none' | 'plain' | 'headless' | 'vanilla' | 'react' | 'react-main';
  n: number;
  pooled: boolean;
};

declare global {
  interface Window {
    ladder: { run(r: Rung): Promise<{ workers: number }> };
  }
}

const surface = (): HTMLElement => {
  const s = document.createElement('section');
  document.getElementById('root')?.append(s);
  return s;
};

window.ladder = {
  async run({ kind, n, pooled }) {
    if (kind === 'none') return { workers: 0 };
    if (kind === 'plain') {
      await Promise.all(
        Array.from({ length: n }, () => {
          const w = new PlainWorker();
          return new Promise((r) => w.addEventListener('message', r, { once: true }));
        }),
      );
      return { workers: n };
    }
    if (kind === 'react-main') {
      for (let i = 0; i < n; i++) createRoot(surface()).render(<Table id={`main${i}`} />);
      await new Promise((r) => setTimeout(r, 200));
      return { workers: 0 };
    }
    const kernel = createKernel({ workers });
    const src = new URL(isolates[kind === 'react' ? 'react' : 'vanilla'] ?? '', location.href).href;
    for (let i = 0; i < n; i++) {
      kernel.spawn({
        id: `${kind}${i}`,
        src,
        ...(kind === 'headless' ? {} : { surface: surface() }),
        ...(pooled ? { pool: 'p' } : {}),
      });
    }
    const deadline = performance.now() + 20_000;
    while (kernel.isolates().some((s) => s.state !== 'running')) {
      if (performance.now() > deadline) throw new Error('isolates did not start');
      // oxlint-disable-next-line no-await-in-loop -- polling
      await new Promise((r) => setTimeout(r, 50));
    }
    return { workers: pooled ? 1 : n };
  },
};
document.body.dataset['ready'] = 'true';
