/// <reference lib="dom" />
/*
 * Bus throughput bench (plan m2-bus, task 13; design §9).
 *
 * One publisher isolate and 10 subscriber isolates, each its own worker,
 * wired to the bus worker with MessageChannels; nothing crosses the main
 * thread. The publisher sends RECORDS records of about 200 bytes, keeping at
 * most WINDOW unanswered, each stamped with an absolute high-resolution time
 * (`timeOrigin + now()`, comparable across workers). Each subscriber reports
 * how many it got, when the first was sent and the last arrived, and the
 * delivery latency of every record.
 *
 * Reported: records/s delivered (all subscribers together, first send to last
 * delivery), records/s published, p50/p95/p99 delivery latency, and how long
 * the bus took to load its contracts. Report only: it sets the budget
 * (≥ 50k records/s delivered) and is the baseline for the M5 engine.
 *
 * Run twice: on a `memory` topic, and on a `persistent` one (M2b task 22),
 * where each publish is acknowledged once its group commit is in OPFS.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import '../../e2e/harness-types';
import { HARNESS } from '../../e2e/servers';

const SUBSCRIBERS = 10;
const RECORDS = 20_000;
const WINDOW = 500;

/** The contracts, as module source: a schema that only checks the shape. */
const contractsFor = (durability: Durability) => `
const schema = { '~standard': { version: 1, vendor: 'bench', validate: (value) =>
  typeof value === 'object' && value !== null ? { value } : { issues: [{ message: 'object', path: [] }] } } };
const any = { '~standard': { version: 1, vendor: 'bench', validate: (value) => ({ value }) } };
const topics = [
  { name: 'tp.v1', schema, retention: { kind: 'last-n', n: 50000 }, durability: '${durability}' },
  { name: 'tp.ctl.v1', schema: any, retention: { kind: 'last-n', n: 1000 } },
];
export default { '~isoloop': 'contracts', topics, get: (n) => topics.find((t) => t.name === n) };
`;

const SUBSCRIBER = `
const tp = { name: 'tp.v1' };
const ctl = { name: 'tp.ctl.v1' };
const abs = () => performance.timeOrigin + performance.now();
export default {
  start(ctx) {
    const total = ctx.config.records;
    const latencies = [];
    let firstSent = 0;
    let lastRecv = 0;
    ctx.bus.subscribe(tp, (r) => {
      const now = abs();
      if (latencies.length === 0) firstSent = r.value.sentAt;
      latencies.push(now - r.value.sentAt);
      lastRecv = now;
      if (latencies.length === total)
        void ctx.bus.publish(ctl, { value: { done: ctx.id, firstSent, lastRecv, latencies } });
    }, { from: 'latest' });
    // Subscribed: tell the host. The subscribe is answered before any later publish is delivered.
    setTimeout(() => void ctx.bus.publish(ctl, { value: { ready: ctx.id } }), 100);
  },
};
`;

const PUBLISHER = `
const tp = { name: 'tp.v1' };
const ctl = { name: 'tp.ctl.v1' };
const abs = () => performance.timeOrigin + performance.now();
export default {
  start(ctx) {
    const { records, window } = ctx.config;
    const pad = 'x'.repeat(80); // about 200 bytes with the other fields, as the bus counts them
    let started = false;
    ctx.bus.subscribe(ctl, async (r) => {
      if (started || r.value.go !== true) return;
      started = true;
      const t0 = abs();
      let sent = 0;
      let inFlight = 0;
      await new Promise((resolve) => {
        const pump = () => {
          while (inFlight < window && sent < records) {
            inFlight++;
            const seq = sent++;
            ctx.bus.publish(tp, { value: { seq, sentAt: abs(), pad } }).then(() => {
              inFlight--;
              if (sent === records && inFlight === 0) resolve();
              else pump();
            });
          }
        };
        pump();
      });
      void ctx.bus.publish(ctl, { value: { published: records, ms: abs() - t0 } });
    }, { from: 'latest' });
  },
};
`;

type Durability = 'memory' | 'persistent';

const round = (x: number): number => Math.round(x * 100) / 100;

const percentiles = (xs: number[]) => {
  const s = [...xs];
  s.sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Number.NaN;
  return {
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(s.at(-1) ?? 0),
  };
};

type Done = { done: string; firstSent: number; lastRecv: number; latencies: number[] };
type Published = { published: number; ms: number };

for (const durability of ['memory', 'persistent'] as const) {
  test(`bus throughput, ${durability}: 1 publisher, 10 subscribers, 200-byte records`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await page.goto(HARNESS);
    await expect(page.locator('body[data-ready]')).toBeAttached();
    const out: unknown = await page.evaluate(
      async ({ contracts, publisher, subscriber, subscribers, records, window: win }) => {
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page
        const blob = (code: string) =>
          URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        const t0 = performance.now();
        const kernel = await window.harness.createBusKernel(blob(contracts));
        let busReadyMs = -1;
        kernel.on('bus:ready', () => {
          busReadyMs = performance.now() - t0;
        });
        let degraded: string | undefined;
        kernel.on('bus:durability-degraded', ({ reason }) => {
          degraded = reason;
        });
        const ctl = { name: 'tp.ctl.v1' };
        const ready = new Set<string>();
        const done: unknown[] = [];
        let published: unknown;
        const all = new Promise<void>((resolve) => {
          kernel.subscribe(ctl, (r) => {
            const v = r.value;
            if (typeof v !== 'object' || v === null) return;
            if ('ready' in v) {
              ready.add(String(v.ready));
              if (ready.size === subscribers) void kernel.publish(ctl, { value: { go: true } });
            }
            if ('done' in v) done.push(v);
            if ('published' in v) published = v;
            if (done.length === subscribers && published) resolve();
          });
        });
        const grants = { publish: ['tp.v1', 'tp.ctl.v1'], subscribe: ['tp.v1', 'tp.ctl.v1'] };
        const sub = blob(subscriber);
        for (let i = 0; i < subscribers; i++)
          kernel.spawn({ id: `S${i}`, src: sub, grants, config: { records } });
        kernel.spawn({ id: 'P', src: blob(publisher), grants, config: { records, window: win } });
        await all;
        const messages = kernel.debug.messages();
        await kernel.destroy();
        return { done, published, busReadyMs, messages, degraded };
      },
      {
        contracts: contractsFor(durability),
        publisher: PUBLISHER,
        subscriber: SUBSCRIBER,
        subscribers: SUBSCRIBERS,
        records: RECORDS,
        window: WINDOW,
      },
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the shape page.evaluate returned above
    const result = out as {
      done: Done[];
      published: Published;
      busReadyMs: number;
      messages: Record<string, number>;
      degraded?: string;
    };
    const first = Math.min(...result.done.map((d) => d.firstSent));
    const last = Math.max(...result.done.map((d) => d.lastRecv));
    const delivered = result.done.reduce((n, d) => n + d.latencies.length, 0);
    const seconds = (last - first) / 1000;
    const report = {
      bench: 'bus-throughput',
      browser: info.project.name,
      durability,
      /** Where the topic lived: OPFS, or memory (a memory topic, or a degraded persistent one). */
      storage:
        durability === 'memory'
          ? 'memory'
          : result.degraded === undefined
            ? 'opfs'
            : `memory (${result.degraded})`,
      subscribers: SUBSCRIBERS,
      records: RECORDS,
      window: WINDOW,
      recordBytes: '≈200 (as the bus estimates them)',
      deliveredPerSec: Math.round(delivered / seconds),
      publishedPerSec: Math.round(result.published.published / (result.published.ms / 1000)),
      latencyMs: percentiles(result.done.flatMap((d) => d.latencies)),
      contractsLoadMs: round(result.busReadyMs),
      /** Design §9: ≥ 50k records/s delivered. Report only. */
      budget: { deliveredPerSec: 50_000, enforced: false },
      /** I7: what the main thread saw, by message type. */
      mainThreadMessages: result.messages,
    };
    console.log(
      `bus throughput, ${durability} on ${report.storage}: ${report.deliveredPerSec} records/s delivered, ${report.publishedPerSec} published, ` +
        `latency p50 ${report.latencyMs.p50} / p95 ${report.latencyMs.p95} ms, contracts ${report.contractsLoadMs} ms`,
    );
    console.log(JSON.stringify(report, null, 2));
    await info.attach(`bus-throughput-${durability}.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    await mkdir('bench-results', { recursive: true });
    await writeFile(
      `bench-results/bus-throughput-${durability}-${info.project.name}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    expect(delivered).toBe(SUBSCRIBERS * RECORDS);
    expect(result.messages['deliver'] ?? 0).toBe(0);
  });
}
