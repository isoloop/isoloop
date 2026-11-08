// The gate page: starts N members as own workers or as one pool, and says
// how long it took until every member's start() had returned.
import PoolWorker from './pool-worker.ts?worker';

declare global {
  interface Window {
    gate: {
      run(mode: 'own' | 'pooled', n: number): Promise<{ startMs: number; workers: number }>;
    };
  }
}

const live: Worker[] = [];

window.gate = {
  async run(mode, n) {
    const ids = Array.from({ length: n }, (_, i) => i);
    const groups = mode === 'own' ? ids.map((i) => [i]) : [ids];
    const t0 = performance.now();
    await Promise.all(
      groups.map(
        (group) =>
          new Promise<void>((resolve) => {
            const w = new PoolWorker();
            live.push(w);
            let left = group.length;
            w.addEventListener('message', () => {
              left -= 1;
              if (left === 0) resolve();
            });
            const ports = group.map(() => new MessageChannel().port1);
            w.postMessage({ members: group, ports }, ports);
          }),
      ),
    );
    return { startMs: performance.now() - t0, workers: groups.length };
  },
};
document.body.dataset['ready'] = String(crossOriginIsolated);
