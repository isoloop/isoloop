/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- CDP payloads are untyped JSON in these plain scripts */
// Plant memory: each thread's V8 heap (Runtime.getHeapUsage on the page and
// every worker), by the worker's name. With GC=1, after a forced GC on every
// thread.
//
//   node heaps.mjs <url> [seconds=16] [out.json]
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { targets } from './targets.mjs';

const [, , url = '', waitS = '16', out] = process.argv;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url);
await page.waitForTimeout(Number(waitS) * 1000);
const t = await targets(await browser.newBrowserCDPSession());
if (process.env['GC']) await t.gcAll();
const MB = 1048576;
const rows = await t.each(async (s, target) => {
  const h = await t.call(s, 'Runtime.getHeapUsage');
  const named = await t.call(s, 'Runtime.evaluate', {
    expression: 'self.name || location.pathname',
    returnByValue: true,
  });
  return {
    type: target.type,
    name: named?.result?.value,
    usedMB: h.usedSize / MB,
    totalMB: h.totalSize / MB,
    embedderMB: (h.embedderHeapUsedSize ?? 0) / MB,
    arrayBuffersMB: (h.backingStorageSize ?? 0) / MB,
  };
});
if (out) writeFileSync(out, JSON.stringify({ url, gc: Boolean(process.env['GC']), rows }, null, 1));
console.table(rows);
await browser.close();
