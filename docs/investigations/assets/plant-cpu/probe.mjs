/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, typescript/restrict-template-expressions -- a throwaway probe over untyped trace JSON (plant-cpu.md) */
// Per-thread CPU of the plant dashboard (docs/investigations/plant-cpu.md).
//
// For each configuration, interleaved over ROUNDS rounds, in a fresh browser:
// load the page, wait for first data and WARM_MS, then
//   1. an untraced window: each renderer thread's CPU from /proc (utime +
//      stime, by tid), plus the GPU and browser processes;
//   2. an events trace of the same length on the same page: timeline, blink,
//      canvas, Skia, GPU-client, IPC and GC events with thread time, no
//      sampling profiler, so what native code does on each thread is timed
//      with little overhead; and
//   3. a profile trace: the V8 sampling profiler on every thread, only to
//      split the time spent in JS by source module.
// The untraced window gives the CPU figures; the traces only split them up
// (analyze.mjs), so tracing's own cost doesn't count.
//
// Run from apps/dashboards/plant in isoloop/examples, with `vite preview` of
// unminified builds on BASE:
//   CONFIGS=native-workers,isoloop:matched RATES=5,1 ROUNDS=3 node probe.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:4792';
const CONFIGS = (process.env.CONFIGS ?? 'native-workers,isoloop:matched,native,isoloop:one').split(
  ',',
);
const RATES = (process.env.RATES ?? '5,1').split(',').map(Number);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const WARM_MS = Number(process.env.WARM_MS ?? 15_000);
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 10_000);
const OUT = process.env.OUT ?? 'cpu-results';
const TICK_MS = 1000 / Number(process.env.CLK_TCK ?? 100);
// NO_TRACE=1: the untraced window only (used for the minified-build check).
const NO_TRACE = process.env.NO_TRACE === '1';

const EVENTS = [
  '-*',
  '__metadata',
  'toplevel',
  'v8',
  'v8.execute',
  'disabled-by-default-v8.gc',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink',
  'blink.worker',
  'blink.canvas',
  'cc',
  'gpu',
  'skia',
  'disabled-by-default-skia',
  'viz',
  'ipc',
  'mojom',
];
const PROFILE = ['-*', '__metadata', 'toplevel', 'disabled-by-default-v8.cpu_profiler'];

/** utime + stime in ms and the thread name, for every thread of `pid`. */
function threads(pid) {
  const out = {};
  let tids = [];
  try {
    tids = readdirSync(`/proc/${pid}/task`);
  } catch {
    return out;
  }
  for (const tid of tids) {
    try {
      const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8');
      // Fields after the parenthesised comm, which may contain spaces.
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const user = Number(rest[11]) * TICK_MS;
      const sys = Number(rest[12]) * TICK_MS;
      const comm = readFileSync(`/proc/${pid}/task/${tid}/comm`, 'utf8').trim();
      out[tid] = { comm, cpu: user + sys, sys };
    } catch {
      // The thread ended between readdir and read.
    }
  }
  return out;
}

async function processes(browser) {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    return processInfo;
  } finally {
    await cdp.detach();
  }
}

function snapshot(procs) {
  const s = {};
  for (const p of procs) s[p.id] = { type: p.type, cpuTime: p.cpuTime, threads: threads(p.id) };
  return s;
}

function delta(a, b, seconds) {
  const out = [];
  for (const [pid, after] of Object.entries(b)) {
    const before = a[pid];
    if (!before) continue;
    for (const [tid, t] of Object.entries(after.threads)) {
      const t0 = before.threads[tid];
      if (!t0) continue;
      const ms = (t.cpu - t0.cpu) / seconds;
      const sys = (t.sys - t0.sys) / seconds;
      if (ms > 0)
        out.push({
          pid: Number(pid),
          type: after.type,
          tid: Number(tid),
          comm: t.comm,
          msPerS: ms,
          sysMsPerS: sys,
        });
    }
  }
  return out.toSorted((x, y) => y.msPerS - x.msPerS);
}

async function run(config, rate, round) {
  const [build, placement] = config.split(':');
  const name = `${placement ? `${build}-${placement}` : build}-${rate}khz-run${round}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const url = `${BASE}/${build}/?rate=${rate}&seed=7${placement ? `&placement=${placement}` : ''}`;
    await page.goto(url);
    await page
      .locator('[data-metric="first-data"] dd')
      .filter({ hasText: /ms$/ })
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(WARM_MS);
    const seconds = WINDOW_MS / 1000;

    // 1. Untraced.
    const p0 = await processes(browser);
    const s0 = snapshot(p0);
    await page.waitForTimeout(WINDOW_MS);
    const p1 = await processes(browser);
    const s1 = snapshot(p1);
    const untraced = delta(s0, s1, seconds);
    const byType = {};
    for (const p of p1) {
      const q = p0.find((x) => x.id === p.id);
      if (q) byType[p.type] = (byType[p.type] ?? 0) + ((p.cpuTime - q.cpuTime) / seconds) * 1000;
    }

    // 2 and 3. Traced, same page.
    mkdirSync(OUT, { recursive: true });
    const traced = {};
    for (const [kind, categories] of NO_TRACE
      ? []
      : [
          ['events', EVENTS],
          ['profile', PROFILE],
        ]) {
      // oxlint-disable-next-line no-await-in-loop -- one trace at a time
      await browser.startTracing(page, { categories, screenshots: false });
      // oxlint-disable-next-line no-await-in-loop -- one trace at a time
      const t0 = snapshot(await processes(browser));
      // oxlint-disable-next-line no-await-in-loop -- one trace at a time
      await page.waitForTimeout(WINDOW_MS);
      // oxlint-disable-next-line no-await-in-loop -- one trace at a time
      const t1 = snapshot(await processes(browser));
      // oxlint-disable-next-line no-await-in-loop -- one trace at a time
      const trace = await browser.stopTracing();
      traced[kind] = delta(t0, t1, seconds);
      writeFileSync(`${OUT}/${name}.${kind}.json.gz`, gzipSync(trace));
    }
    writeFileSync(
      `${OUT}/${name}.json`,
      `${JSON.stringify({ config, build, placement: placement ?? null, rate, round, windowMs: WINDOW_MS, warmMs: WARM_MS, processMsPerS: byType, untraced, traced }, null, 1)}\n`,
    );
    const rt = untraced.filter((t) => t.type === 'renderer');
    const r = rt.reduce((s, t) => s + t.msPerS, 0);
    const sys = rt.reduce((s, t) => s + t.sysMsPerS, 0);
    console.log(
      `${name}: renderer ${Math.round(r)} ms/s (kernel ${Math.round(sys)}; process ${Math.round(byType.renderer ?? 0)}), gpu ${Math.round(byType.GPU ?? 0)}`,
    );
  } finally {
    await browser.close();
  }
}

for (const rate of RATES) {
  for (let round = 1; round <= ROUNDS; round++) {
    for (const config of CONFIGS) {
      // oxlint-disable-next-line no-await-in-loop -- one page at a time
      await run(config, rate, round);
    }
  }
}
