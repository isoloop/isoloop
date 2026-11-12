/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- CDP payloads are untyped JSON in these plain scripts */
// Plant memory ladder: one rung of bench/memory-ladder per fresh Chromium,
// renderer PSS and V8 heaps after a forced GC on every thread.
//
//   pnpm exec vite build --config bench/memory-ladder/vite.config.ts
//   pnpm exec vite preview --config bench/memory-ladder/vite.config.ts --port 4795
//   node ladder.mjs '{"kind":"react","n":8,"pooled":true}'
//
// kinds: none, plain (plain workers), headless, vanilla (visual), react,
// react-main (the same React widget on the page's main thread).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { targets } from './targets.mjs';

const rung = JSON.parse(process.argv[2] ?? '{"kind":"none","n":0,"pooled":false}');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:4795/');
await page.waitForSelector('body[data-ready="true"]', { state: 'attached' });
const r = await page.evaluate((x) => window.ladder.run(x), rung);
await page.waitForTimeout(3000);
const b = await browser.newBrowserCDPSession();
const t = await targets(b);
await t.gcAll();
const heaps = await t.each((s) => t.call(s, 'Runtime.getHeapUsage'));
await page.waitForTimeout(1500);
const { processInfo } = await b.send('SystemInfo.getProcessInfo');
let pss = 0;
for (const p of processInfo.filter((x) => x.type === 'renderer')) {
  const s = readFileSync(`/proc/${p.id}/smaps_rollup`, 'utf8');
  pss += Number(/^Pss:\s+(\d+)/m.exec(s)?.[1] ?? 0) / 1024;
}
const sum = (k) => heaps.reduce((n, h) => n + h[k], 0) / 1048576;
console.log(
  JSON.stringify({
    ...rung,
    workers: r.workers,
    pss,
    heapUsedMB: sum('usedSize'),
    heapTotalMB: sum('totalSize'),
  }),
);
await browser.close();
