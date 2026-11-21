// The bus controller's side of the inspection feed (ADR 0020, decisions 2
// and 3) against the real bus worker: taps, reads, the restart count.
import type { BusMetrics, BusToTap, RecordPreview } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list from '../__fixtures__/contracts';
import { createBusController, type BusController } from '../bus/controller';
import { DEFAULT_SUPERVISOR_CONFIG } from '../supervisor/machine';

const busWorker = `${new URL('../../../bus/src/worker.ts', import.meta.url).href}?worker_file&type=module`;
const contractsUrl = new URL('../__fixtures__/contracts.ts', import.meta.url).href;

const noop = (): void => {};

const controllers: BusController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.destroy();
});

function setup() {
  const metrics: BusMetrics[] = [];
  let ready = 0;
  const c = createBusController({
    workerUrl: busWorker,
    contracts: { url: contractsUrl, list },
    heartbeatMs: 100,
    supervisor: { ...DEFAULT_SUPERVISOR_CONFIG, backoff: { initialMs: 50, factor: 2, maxMs: 50 } },
    dev: true,
    events: {
      ready: () => ready++,
      recovered: noop,
      degraded: noop,
      crash: noop,
      restart: noop,
      failed: noop,
      metrics: (m) => metrics.push(m),
      reattach: noop,
      wake: noop,
      seed: noop,
      orphaned: noop,
    },
  });
  controllers.push(c);
  return { c, metrics, ready: () => ready };
}

const records = (got: BusToTap[]): RecordPreview[] =>
  got.flatMap((m) => (m.t === 'record' ? [m.p] : []));

describe('inspection feed: bus side', () => {
  it('a tap sees records, is no consumer in the metrics, and is opened again after a bus restart', async () => {
    const { c, metrics, ready } = setup();
    const got: BusToTap[] = [];
    c.tap({ topics: ['count.v1'] }, (m) => got.push(m));
    const seen: number[] = [];
    c.subscribe({ topic: 'count.v1', from: 'earliest', fn: (r) => seen.push(r.offset) });
    await c.publish('count.v1', undefined, 1);
    await c.publish('notes.v1', 'k', 'not tapped');
    await vi.waitUntil(() => records(got).length === 1);
    expect(records(got)[0]).toMatchObject({ topic: 'count.v1', offset: 0, preview: '1' });

    await vi.waitUntil(() => metrics.length > 0, { timeout: 3000 });
    const m = metrics.at(-1);
    // Only the host subscription is a consumer; the tap isn't there.
    expect(m?.subscriptions.map((s) => s.topic)).toEqual(['count.v1']);
    expect(m?.topics.find((t) => t.topic === 'count.v1')).toMatchObject({ head: 1, retained: 1 });

    expect(c.restarts).toBe(0);
    c.crash();
    await vi.waitUntil(() => ready() === 2, { timeout: 3000 });
    expect(c.restarts).toBe(1);
    await c.publish('count.v1', undefined, 2);
    await vi.waitUntil(() => records(got).length === 2);
    // The new bus's memory log starts again at 0.
    expect(records(got)[1]).toMatchObject({ topic: 'count.v1', preview: '2' });
  });

  it('a closed tap gets nothing more', async () => {
    const { c } = setup();
    const got: BusToTap[] = [];
    const stop = c.tap({ topics: ['*'] }, (m) => got.push(m));
    await c.publish('count.v1', undefined, 1);
    await vi.waitUntil(() => got.length === 1);
    stop();
    await c.publish('count.v1', undefined, 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toHaveLength(1);
  });

  it('a read returns the last records as previews, capped at 100', async () => {
    const { c } = setup();
    for (let i = 0; i < 105; i++) void c.publish('count.v1', undefined, i);
    await c.publish('count.v1', undefined, 105);
    const r = await c.read('count.v1', 3);
    expect(r).toMatchObject({
      ok: true,
      value: [{ preview: '103' }, { preview: '104' }, { preview: '105' }],
    });
    const all = await c.read('count.v1', 500);
    expect(all.ok && Array.isArray(all.value) && all.value.length).toBe(100);
    expect(await c.read('nope.v1', 1)).toMatchObject({
      ok: false,
      error: { code: 'unknown_topic' },
    });
  });
});
