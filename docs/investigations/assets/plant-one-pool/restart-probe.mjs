/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, no-await-in-loop, no-underscore-dangle -- a throwaway probe over untyped trace and page data (plant-one-pool.md) */
// Throwaway: phases of the `one` pool's restart after a 3 s block, by hold.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const BASE = process.env.BASE ?? 'http://localhost:4792';
const HOLDS = (process.env.HOLDS ?? '20,120,300,600,20,600').split(',').map(Number);
const PLACEMENT = process.env.PLACEMENT ?? 'one';
const TOPICS = [
  'plant.t3.scalars',
  'plant.t3.spectrum',
  'plant.t3.vib',
  'plant.t3.health',
  'plant.t3.stats',
  'plant.alarms',
  'plant.events',
  'plant.fleet',
];
const out = [];
for (const hold of HOLDS) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE}/isoloop/?placement=${PLACEMENT}&rate=1`);
  await page
    .locator('[data-metric="first-data"] dd')
    .filter({ hasText: /ms$/ })
    .waitFor({ timeout: 60_000 });
  const t0 = Date.now();
  await page.evaluate(() => {
    window.__ev = [];
    for (const k of ['isolate:crash', 'isolate:ready', 'isolate:state'])
      window.kernel.on(k, (e) =>
        window.__ev.push({ t: Date.now(), k, id: e.id, state: e.state, pool: e.pool }),
      );
  });
  await page.waitForTimeout(Math.max(0, t0 + hold * 1000 - Date.now() - 6000));
  // Retained records per topic: a host subscription from the earliest record, counted for 4 s.
  const retained = await page.evaluate(async (topics) => {
    const n = {};
    const offs = topics.map((name) => {
      n[name] = 0;
      return window.kernel.subscribe(
        { name, schema: { '~standard': {} } },
        () => {
          n[name]++;
        },
        { from: 'earliest' },
      );
    });
    await new Promise((r) => setTimeout(r, 4000));
    offs.forEach((f) => f());
    return n;
  }, TOPICS);
  await page.evaluate(() => {
    window.spectra = {};
    for (const m of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']) {
      const ts = (window.spectra[m] = []);
      window.kernel.subscribe(
        { name: `plant.${m.toLowerCase()}.spectrum`, schema: { '~standard': {} } },
        (r) => ts.push({ ts: r.value.ts, at: Date.now() }),
      );
    }
  });
  await page.waitForTimeout(2000);
  await page.locator('[data-slot="T3-gauges"]').hover();
  const clicked = Date.now();
  await page.locator('[data-slot="T3-gauges"] button[name="stress-block"]').click();
  // Recovery as comparison.spec.ts measures it.
  let recoveryMs = null;
  for (const end = Date.now() + 20_000; Date.now() < end;) {
    const [g, s, t] = await page
      .evaluate(() => [
        document.querySelector('[data-slot="T3-gauges"] .gauges')?.getAttribute('data-ts'),
        document.querySelector('[data-slot="T3-sensors"] .sensors')?.getAttribute('data-ts'),
        document.querySelector('[data-slot="T3-temps"] canvas')?.getAttribute('data-drawn'),
      ])
      .catch(() => [null, null, null]);
    const at = Number(/at (\d+)$/.exec(t ?? '')?.[1] ?? 0);
    if (Number(g) > clicked && Number(s) > clicked && at > clicked) {
      recoveryMs = Date.now() - clicked;
      break;
    }
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(3000);
  const { ev, spectra } = await page.evaluate(() => ({ ev: window.__ev, spectra: window.spectra }));
  const after = ev.filter((e) => e.t >= clicked);
  const crash = after.filter((e) => e.k === 'isolate:crash');
  const ready = after.filter((e) => e.k === 'isolate:ready');
  const firstSpec = Object.fromEntries(
    Object.entries(spectra).map(([m, xs]) => [
      m,
      (xs.find((x) => x.at > (crash[0]?.t ?? clicked)) ?? {}).at - clicked,
    ]),
  );
  const row = {
    placement: PLACEMENT,
    hold,
    recoveryMs,
    retained,
    crashMs: crash.length ? crash[0].t - clicked : null,
    crashed: crash.length,
    firstReadyMs: ready.length ? ready[0].t - clicked : null,
    lastReadyMs: ready.length ? ready.at(-1).t - clicked : null,
    ready: ready.length,
    firstSpectrumMs: firstSpec,
    states: [...new Set(after.filter((e) => e.k === 'isolate:state').map((e) => e.state))],
  };
  console.log(JSON.stringify(row));
  out.push(row);
  await browser.close();
}
writeFileSync(process.env.OUT ?? 'restart-probe.json', JSON.stringify(out, null, 1));
