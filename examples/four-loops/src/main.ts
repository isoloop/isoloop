import busWorker from '@isoloop/bus/worker?worker&url';
import { createKernel, type Kernel } from '@isoloop/host';
import bootstrap from '@isoloop/runtime/bootstrap?worker&url';
import { blockMain, busLogText, createPane, startFps } from './chrome';
import list, { count, note, primes } from './contracts';
import contractsUrl from './contracts?isolate';
import counter from './isolates/counter?isolate';
import heavy from './isolates/heavy?isolate';
import messages from './isolates/messages?isolate';
import ticker from './isolates/ticker?isolate';
import './page.css';
import surfaceCss from './surface.css?inline';

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
};

const sheet = new CSSStyleSheet();
sheet.replaceSync(surfaceCss);

// The real supervisor's defaults: backoff 250 ms × 2ⁿ, and the fourth crash
// within 60 s fails the isolate, which then shows the kernel's fallback.
// `?killAfterMs=…` shortens the hang limit, for the E2E kill-path test.
const killAfterMs = Number(new URLSearchParams(location.search).get('killAfterMs')) || undefined;
const kernel = createKernel({
  // The bus worker imports the contracts by URL; the host imports the same
  // module for its list (ADR 0003, decision 4).
  contracts: { url: contractsUrl, list },
  workers: { isolateBootstrap: bootstrap, bus: busWorker },
  styles: [sheet],
  ...(killAfterMs ? { heartbeat: { killAfterMs } } : {}),
});

declare global {
  interface Window {
    /** For the E2E suite: the demo's kernel, to observe its events. */
    kernel: Kernel;
    /** For the E2E suite: main-thread message counts by type (invariant I7). */
    __isoloop: Kernel['debug'];
  }
}
window.kernel = kernel;
window.__isoloop = kernel.debug;

// Each isolate gets exactly the topics it uses; the bus enforces it (I4).
const isolates = [
  {
    id: 'A',
    name: 'A · Counter',
    src: counter,
    grants: { publish: ['count.v1'], subscribe: ['note.v1'] },
  },
  { id: 'B', name: 'B · Ticker', src: ticker, grants: { publish: [], subscribe: [] } },
  {
    id: 'C',
    name: 'C · Heavy work',
    src: heavy,
    grants: { publish: ['primes.v1'], subscribe: ['count.v1'] },
  },
  {
    id: 'D',
    name: 'D · Messages',
    src: messages,
    grants: { publish: ['note.v1'], subscribe: ['count.v1', 'primes.v1'] },
  },
];

const root = $('root');
const panes = isolates.map(({ id, name, src, grants }) => {
  const pane = createPane(root, id, name, kernel);
  kernel.spawn({ id, src, surface: pane.body, grants });
  return pane;
});

setInterval(() => {
  const byId = new Map(kernel.isolates().map((s) => [s.id, s]));
  for (const pane of panes) pane.paint(byId.get(pane.id));
}, 100);

const buslog = $('buslog');
// The host's own subscriptions: the only records that cross the main thread.
for (const t of [count.name, note.name, primes.name]) {
  kernel.subscribe({ name: t, schema: { '~standard': {} } }, (r) => {
    buslog.textContent = busLogText(t, r);
  });
}

startFps($('fps'));
$('block-main').addEventListener('click', () => {
  blockMain(1000);
});
