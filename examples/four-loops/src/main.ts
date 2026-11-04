import { createKernel } from '@isoloop/host';
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

const kernel = createKernel({ workers: { isolateBootstrap: bootstrap }, styles: [sheet] });

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
