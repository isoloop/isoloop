/// <reference lib="dom" />
/*
 * M2c benchmark gate (task 0, decision 3): 20 small headless isolates as 20
 * own workers or as one pool, on Chromium, Firefox and WebKit.
 *
 * - Memory: the browser's whole process tree, proportional set size (PSS,
 *   Linux /proc/<pid>/smaps_rollup), after the members started and idled,
 *   minus the same page before they started. On Chromium also
 *   `performance.measureUserAgentSpecificMemory()`, the bytes of the worker
 *   realms.
 * - Start-up: from the first `new Worker` to the last member's `start()`
 *   returning, measured in the page.
 *
 * Each run gets a fresh browser, so both modes start cold. Results go to
 * bench-results/pools.json; the gate is decided in the README.
 */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { test } from '@playwright/test';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';

const PAGE = 'http://localhost:4811/';
const N = 20;
const RUNS = Number(process.env['GATE_RUNS'] ?? '5');
const IDLE_MS = 2000;

async function children(): Promise<Map<number, number[]>> {
  const kids = new Map<number, number[]>();
  const pids = (await readdir('/proc')).filter((d) => /^\d+$/.test(d));
  const stats = await Promise.all(
    pids.map(async (d) => readFile(`/proc/${d}/stat`, 'utf8').catch(() => null)),
  );
  pids.forEach((d, i) => {
    const stat = stats[i];
    if (!stat) return; // gone
    // pid (comm) state ppid …; comm may hold spaces, so split after ')'.
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    const list = kids.get(ppid) ?? [];
    list.push(Number(d));
    kids.set(ppid, list);
  });
  return kids;
}

/** PSS of a process and all its descendants, in MB. */
async function treePssMB(root: number): Promise<number> {
  const kids = await children();
  const tree: number[] = [];
  const todo = [root];
  for (let pid = todo.pop(); pid !== undefined; pid = todo.pop()) {
    tree.push(pid);
    todo.push(...(kids.get(pid) ?? []));
  }
  const rollups = await Promise.all(
    tree.map(async (pid) => readFile(`/proc/${pid}/smaps_rollup`, 'utf8').catch(() => '')),
  );
  const kb = rollups.reduce((sum, s) => sum + Number(/^Pss:\s+(\d+)/m.exec(s)?.[1] ?? 0), 0);
  return kb / 1024;
}

type Sample = { startMs: number; pssMB: number; workerRealmMB?: number };

const ENGINES: [string, BrowserType, object][] = [
  [
    'chromium',
    chromium,
    { channel: 'chromium', args: ['--enable-blink-features=ForceEagerMeasureMemory'] },
  ],
  ['firefox', firefox, {}],
  ['webkit', webkit, {}],
];

const median = (xs: number[]): number => {
  const s = [...xs];
  s.sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] ?? Number.NaN;
  return s.length % 2 ? hi : ((s[mid - 1] ?? Number.NaN) + hi) / 2;
};

test('pool gate: 20 headless isolates, own workers vs one pool', async () => {
  const out: Record<string, Record<string, Sample[]>> = {};
  for (const [name, type, opts] of ENGINES) {
    out[name] = { own: [], pooled: [] };
    for (let r = 0; r < RUNS; r++) {
      // Alternate the order so neither mode always goes first.
      for (const mode of r % 2 ? (['pooled', 'own'] as const) : (['own', 'pooled'] as const)) {
        // oxlint-disable-next-line no-await-in-loop -- one browser at a time, so runs don't compete
        const server = await type.launchServer(opts);
        // oxlint-disable-next-line no-await-in-loop
        const browser = await type.connect(server.wsEndpoint());
        try {
          // oxlint-disable-next-line no-await-in-loop
          const page = await browser.newPage();
          // oxlint-disable-next-line no-await-in-loop
          await page.goto(PAGE);
          // oxlint-disable-next-line no-await-in-loop
          await page.waitForSelector('body[data-ready]', { state: 'attached' });
          // oxlint-disable-next-line no-await-in-loop
          await page.waitForTimeout(IDLE_MS);
          const pid = server.process().pid ?? 0;
          // oxlint-disable-next-line no-await-in-loop
          const before = await treePssMB(pid);
          // oxlint-disable-next-line no-await-in-loop
          const { startMs } = await page.evaluate(([m, n]) => window.gate.run(m, n), [
            mode,
            N,
          ] as const);
          // oxlint-disable-next-line no-await-in-loop
          await page.waitForTimeout(IDLE_MS);
          // oxlint-disable-next-line no-await-in-loop
          const after = await treePssMB(pid);
          // oxlint-disable-next-line no-await-in-loop
          const workerRealmMB = await page.evaluate(async () => {
            const measure: unknown = Reflect.get(performance, 'measureUserAgentSpecificMemory');
            if (!crossOriginIsolated || typeof measure !== 'function') return undefined;
            const report: unknown = await Reflect.apply(measure, performance, []);
            // The report is the browser's, read field by field.
            const entries: unknown[] =
              typeof report === 'object' && report !== null && 'breakdown' in report
                ? [report.breakdown].flat()
                : [];
            let bytes = 0;
            for (const e of entries) {
              if (typeof e !== 'object' || e === null) continue;
              const b: unknown = Reflect.get(e, 'bytes');
              const attribution: unknown = Reflect.get(e, 'attribution');
              const worker =
                Array.isArray(attribution) &&
                attribution.some(
                  (a: unknown) =>
                    typeof a === 'object' &&
                    a !== null &&
                    Reflect.get(a, 'scope') === 'DedicatedWorkerGlobalScope',
                );
              if (worker && typeof b === 'number') bytes += b;
            }
            return bytes / 2 ** 20;
          });
          const sample: Sample = {
            startMs: Math.round(startMs),
            pssMB: Number((after - before).toFixed(1)),
            ...(workerRealmMB === undefined
              ? {}
              : { workerRealmMB: Number(workerRealmMB.toFixed(1)) }),
          };
          out[name]?.[mode]?.push(sample);
          console.log(`${name} ${mode.padEnd(6)} run ${r + 1}: ${JSON.stringify(sample)}`);
        } finally {
          // oxlint-disable-next-line no-await-in-loop
          await browser.close();
          // oxlint-disable-next-line no-await-in-loop
          await server.close();
        }
      }
    }
  }
  const summary: Record<string, unknown> = {};
  for (const [name, modes] of Object.entries(out)) {
    const m = (mode: string, k: keyof Sample) =>
      median((modes[mode] ?? []).map((s) => s[k]).filter((v): v is number => v !== undefined));
    summary[name] = {
      own: {
        startMs: m('own', 'startMs'),
        pssMB: m('own', 'pssMB'),
        workerRealmMB: m('own', 'workerRealmMB'),
      },
      pooled: {
        startMs: m('pooled', 'startMs'),
        pssMB: m('pooled', 'pssMB'),
        workerRealmMB: m('pooled', 'workerRealmMB'),
      },
    };
    console.log(name, JSON.stringify(summary[name]));
  }
  await mkdir('bench-results', { recursive: true });
  await writeFile(
    'bench-results/pools.json',
    `${JSON.stringify({ n: N, runs: RUNS, summary, samples: out }, null, 2)}\n`,
  );
});
