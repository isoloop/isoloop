/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- CDP payloads are untyped JSON in these plain scripts */
// Plant memory probe (docs/investigations/plant-memory.md): loads one page in
// a fresh Chromium, waits, and records the renderer's PSS from
// /proc/<pid>/smaps_rollup (the same figure as the plant comparison) and a
// detailed memory-infra dump of its allocators. With GC=1 it first forces a
// full garbage collection on every thread (page and workers).
//
//   node probe.mjs <url> [seconds=16] [out.json]
//   GC=1 node probe.mjs ...           # after a forced GC on every thread
//   CHROME_ARGS="--js-flags=..." ...  # extra Chromium flags
//
// Linux only (it reads /proc). Run from a directory where @playwright/test
// resolves.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { targets } from './targets.mjs';

const [, , url = '', waitS = '16', out] = process.argv;
const browser = await chromium.launch({
  headless: true,
  args: process.env['CHROME_ARGS'] ? process.env['CHROME_ARGS'].split(' ') : [],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url);
await page.waitForTimeout(Number(waitS) * 1000);
const b = await browser.newBrowserCDPSession();
const t = await targets(b);
if (process.env['GC']) {
  await t.gcAll();
  await page.waitForTimeout(1500);
}

const { processInfo } = await b.send('SystemInfo.getProcessInfo');
const renderers = processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
const mb = (text, key) =>
  Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0) / 1024;
const procs = renderers.map((pid) => {
  const s = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
  return {
    pid,
    pss: mb(s, 'Pss'),
    pssAnon: mb(s, 'Pss_Anon'),
    pssFile: mb(s, 'Pss_File'),
    pssShmem: mb(s, 'Pss_Shmem'),
  };
});

// memory-infra: one detailed dump, allocator sizes in MB for the renderer.
const events = [];
b.on('Tracing.dataCollected', (e) => events.push(...e.value));
await b.send('Tracing.start', {
  traceConfig: {
    includedCategories: ['disabled-by-default-memory-infra'],
    excludedCategories: ['*'],
    memoryDumpConfig: { triggers: [] },
  },
  transferMode: 'ReportEvents',
});
await b.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
const complete = new Promise((resolve) => {
  b.once('Tracing.tracingComplete', resolve);
});
await b.send('Tracing.end');
await complete;
const allocators = {};
for (const ev of events) {
  if (ev.ph !== 'v' || !renderers.includes(ev.pid)) continue;
  for (const [name, v] of Object.entries(ev.args?.dumps?.allocators ?? {})) {
    const size = v.attrs?.size?.value;
    if (size) allocators[name] = parseInt(size, 16) / 1048576;
  }
}
const workers = (await t.list()).filter((x) => x.type === 'worker').length;
const result = { url, gc: Boolean(process.env['GC']), workers, procs, allocators };
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
else console.log(JSON.stringify({ ...result, allocators: undefined }, null, 1));
await browser.close();
