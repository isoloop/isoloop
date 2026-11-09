/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- CDP payloads are untyped JSON in these plain scripts */
// Plant memory: JavaScript allocation per thread over a window, including
// objects already collected (HeapProfiler sampling), with the top allocating
// functions. Use an unminified build for readable names.
//
//   node alloc.mjs <url> [seconds=5] [out.json]
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { targets } from './targets.mjs';

const [, , url = '', secs = '5', out] = process.argv;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url);
await page.waitForTimeout(14_000);
const t = await targets(await browser.newBrowserCDPSession());
const sampling = { samplingInterval: 16384 };
const started = await t.each(async (s) => {
  const named = await t.call(s, 'Runtime.evaluate', {
    expression: 'self.name || location.pathname',
    returnByValue: true,
  });
  await t.call(s, 'HeapProfiler.enable');
  await t.call(s, 'HeapProfiler.startSampling', {
    ...sampling,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  return named?.result?.value;
});
await page.waitForTimeout(Number(secs) * 1000);
const names = [...started];
const res = {};
const profiles = await t.each((s) => t.call(s, 'HeapProfiler.stopSampling'));
for (const [i, r] of profiles.entries()) {
  const bySite = new Map();
  let total = 0;
  const walk = (n) => {
    const f = n.callFrame;
    const site = `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\//, '')}:${f.lineNumber}`;
    total += n.selfSize;
    if (n.selfSize) bySite.set(site, (bySite.get(site) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c);
  };
  walk(r.profile.head);
  const perSec = (bytes) => bytes / 1048576 / Number(secs);
  res[names[i] ?? i] = {
    mbPerSec: perSec(total),
    top: [...bySite]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([k, v]) => [k, perSec(v)]),
  };
}
if (out) writeFileSync(out, JSON.stringify(res, null, 1));
for (const [k, v] of Object.entries(res)) console.log(k, v.mbPerSec.toFixed(2), 'MB/s');
await browser.close();
