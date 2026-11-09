// The gate page: starts 8 widgets as own workers or as one pool, applies
// their batches on animation frames (as the host's compositor does), and
// reports start-up and the time from a record being published to its patch
// being applied.
import { createApplier, type SanitisePolicy } from '../../../packages/dom/src/host/applier.ts';
import FeedWorker from './feed-worker.ts?worker';
import WidgetWorker from './widget-worker.tsx?worker';
import { now } from './records.ts';

const OPEN: SanitisePolicy = {
  element: (tag, ns) => ({ tag, ns }),
  attribute: (_t, _n, _name, value) => value,
  property: () => true,
};

type Result = { startMs: number; workers: number };
type Latency = { p50: number; p95: number; n: number };

declare global {
  interface Window {
    visualGate: {
      run(mode: 'own' | 'pooled', n: number): Promise<Result>;
      latency(ms: number): Promise<Latency>;
    };
  }
}

const surfaces = document.getElementById('surfaces')!;
const queue: { apply: () => void }[] = [];
const watched: Element[] = [];
const lastSeen = new WeakMap<Element, string>();
let sampling: number[] | null = null;

const frame = (): void => {
  for (const job of queue.splice(0)) job.apply();
  if (sampling) {
    const t = now();
    for (const container of watched) {
      for (const el of container.querySelectorAll('[data-t]')) {
        const v = el.getAttribute('data-t') ?? '';
        if (lastSeen.get(el) === v) continue;
        lastSeen.set(el, v);
        sampling.push(t - Number(v));
      }
    }
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

const pct = (xs: number[], p: number): number => {
  const s = [...xs];
  s.sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN;
};

window.visualGate = {
  async run(mode, n) {
    const ids = Array.from({ length: n }, (_, i) => i);
    const groups = mode === 'own' ? ids.map((i) => [i]) : [ids];
    const channels = ids.map(() => new MessageChannel());
    const t0 = performance.now();
    await Promise.all(
      groups.map(
        (group) =>
          new Promise<void>((resolve) => {
            const container = document.createElement('div');
            surfaces.append(container);
            watched.push(container);
            const applier = createApplier(container, OPEN);
            const w = new WidgetWorker();
            w.addEventListener('message', (e: MessageEvent<{ t: string; batch?: unknown }>) => {
              if (e.data.t === 'batch') queue.push({ apply: () => applier.apply(e.data.batch) });
              // Ready once the batches before it are on screen.
              else if (e.data.t === 'ready') queue.push({ apply: resolve });
            });
            const ports = group.map((m) => channels[m]!.port2);
            w.postMessage({ members: group, ports }, ports);
          }),
      ),
    );
    const startMs = performance.now() - t0;
    const feed = new FeedWorker();
    const feedPorts = channels.map((c) => c.port1);
    feed.postMessage({ ports: feedPorts }, feedPorts);
    return { startMs, workers: groups.length };
  },
  async latency(ms) {
    sampling = [];
    await new Promise((r) => setTimeout(r, ms));
    const xs = sampling;
    sampling = null;
    return { p50: pct(xs, 50), p95: pct(xs, 95), n: xs.length };
  },
};
document.body.dataset['ready'] = String(crossOriginIsolated);
