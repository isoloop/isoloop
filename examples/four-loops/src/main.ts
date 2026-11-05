import { createKernel, type Kernel } from '@isoloop/host';
import bootstrap from '@isoloop/runtime/bootstrap?worker&url';
import { blockMain, busLogText, createPane, startFps } from './chrome';
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
  workers: { isolateBootstrap: bootstrap },
  styles: [sheet],
  ...(killAfterMs ? { heartbeat: { killAfterMs } } : {}),
});

declare global {
  interface Window {
    /** For the E2E suite: the demo's kernel, to observe its events. */
    kernel: Kernel;
  }
}
window.kernel = kernel;

const isolates = [
  { id: 'A', name: 'A · Counter', src: counter },
  { id: 'B', name: 'B · Ticker', src: ticker },
  { id: 'C', name: 'C · Heavy work', src: heavy },
  { id: 'D', name: 'D · Messages', src: messages },
];

const root = $('root');
const panes = isolates.map(({ id, name, src }) => {
  const pane = createPane(root, id, name, kernel);
  kernel.spawn({ id, src, surface: pane.body });
  return pane;
});

setInterval(() => {
  const byId = new Map(kernel.isolates().map((s) => [s.id, s]));
  for (const pane of panes) pane.paint(byId.get(pane.id));
}, 100);

const buslog = $('buslog');
kernel.on('bus:publish', (d) => {
  buslog.textContent = busLogText(d);
});

startFps($('fps'));
$('block-main').addEventListener('click', () => {
  blockMain(1000);
});
