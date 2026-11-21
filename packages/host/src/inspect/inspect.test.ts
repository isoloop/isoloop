// The inspection feed (ADR 0020): `kernel.inspect()` against real workers,
// and the feed's ring buffer and coalescing on their own.
import {
  INSPECT_RING_SIZE,
  isInspectMessage,
  type InspectBeat,
  type InspectMessage,
} from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list from '../__fixtures__/contracts';
import { createInspectFeed } from './inspect';
import { createKernel, type Kernel } from '../index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const bootstrap = worker('../../../runtime/src/bootstrap.ts');
const busWorker = worker('../../../bus/src/worker.ts');
const contractsUrl = new URL('../__fixtures__/contracts.ts', import.meta.url).href;
const burn = new URL('../__fixtures__/burn.ts', import.meta.url).href;
const throws = new URL('../__fixtures__/throws.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function kernel(withBus = false): Kernel {
  const k = createKernel({
    workers: { isolateBootstrap: bootstrap, ...(withBus ? { bus: busWorker } : {}) },
    ...(withBus ? { contracts: { url: contractsUrl, list } } : {}),
    supervisor: { maxRestarts: 1, backoff: { initialMs: 20 } },
  });
  kernels.push(k);
  return k;
}

const waitFor = (ok: () => boolean, timeout = 5000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 20 },
  );

const sleep = (ms: number) =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

const ofType = <T extends InspectMessage['t']>(ms: InspectMessage[], t: T) =>
  ms.filter((m): m is Extract<InspectMessage, { t: T }> => m.t === t);

describe('kernel.inspect() (ADR 0020)', () => {
  it('gives a snapshot of isolates and pools as plain data', async () => {
    const k = kernel();
    k.spawn({ id: 'A', src: burn });
    k.spawn({ id: 'B', src: burn, pool: 'p' });
    await waitFor(() => k.isolates().every((i) => i.state === 'running'));
    const snap = k.inspect().snapshot();
    expect(new Set(snap.isolates.map((i) => i.id))).toEqual(new Set(['A', 'B']));
    expect(snap.isolates.find((i) => i.id === 'B')?.pool).toBe('p');
    expect(snap.pools.map((p) => p.name)).toEqual(['p']);
    expect(snap.bus).toEqual({ state: 'none', restarts: 0 });
    // Plain data: it survives structured cloning unchanged.
    expect(structuredClone(snap)).toEqual(snap);
  });

  it('sends events at once, as envelopes every reader can check', async () => {
    const k = kernel();
    const got: InspectMessage[] = [];
    k.inspect().on((m) => got.push(m));
    k.spawn({ id: 'A', src: burn });
    await waitFor(() =>
      ofType(got, 'event').some(
        (m) => m.p.event === 'isolate:state' && m.p.data['state'] === 'running',
      ),
    );
    expect(got.every((m) => isInspectMessage(m))).toBe(true);
    expect(ofType(got, 'event').every((m) => m.p.data['id'] === 'A')).toBe(true);
  });

  it('coalesces beats to about one message a second, with the latest per isolate', async () => {
    const k = kernel();
    k.spawn({ id: 'A', src: burn });
    k.spawn({ id: 'B', src: burn });
    const raw: unknown[] = [];
    k.on('isolate:beat', (b) => raw.push(b));
    const got: InspectMessage[] = [];
    k.inspect().on((m) => got.push(m));
    await sleep(2_600);
    const beats = ofType(got, 'beats');
    // More beats arrive than messages are sent.
    expect(raw.length).toBeGreaterThan(beats.length * 2);
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats.length).toBeLessThanOrEqual(3);
    for (const m of beats) {
      const ids = m.p.beats.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(new Set(['A', 'B']));
    }
  });

  it('keeps crashes from before anyone inspected, in the ring buffer', async () => {
    const k = kernel();
    k.spawn({ id: 'X', src: throws });
    await waitFor(() => k.isolates()[0]?.state === 'failed');
    const events = k.inspect().snapshot().events;
    const names = events.map((e) => e.event);
    expect(names).toContain('isolate:crash');
    expect(names).toContain('isolate:failed');
    // Oldest first.
    for (let i = 1; i < events.length; i++)
      expect(events[i]!.at).toBeGreaterThanOrEqual(events[i - 1]!.at);
  });

  it('keeps a crash that happens while a reader listens in the buffer too', async () => {
    const k = kernel();
    const got: InspectMessage[] = [];
    const inspector = k.inspect();
    inspector.on((m) => got.push(m));
    k.spawn({ id: 'X', src: throws });
    await waitFor(() => ofType(got, 'event').some((m) => m.p.event === 'isolate:failed'));
    const crashes = inspector.snapshot().events.filter((e) => e.event === 'isolate:crash');
    expect(crashes.length).toBe(
      ofType(got, 'event').filter((m) => m.p.event === 'isolate:crash').length,
    );
  });

  it('reports the bus: its state, its restarts and the latest metrics', async () => {
    const k = kernel(true);
    const got: InspectMessage[] = [];
    const inspector = k.inspect();
    inspector.on((m) => got.push(m));
    await waitFor(() => ofType(got, 'metrics').length >= 1, 8000);
    expect(inspector.snapshot().bus.metrics).toBeDefined();
    k.debug.crashBus();
    await waitFor(() => inspector.snapshot().bus.restarts === 1, 8000);
    await waitFor(() => inspector.snapshot().bus.state === 'running', 8000);
    expect(ofType(got, 'event').some((m) => m.p.event === 'bus:restart')).toBe(true);
    // Metrics come coalesced, never as single events.
    expect(ofType(got, 'event').some((m) => m.p.event === 'bus:metrics')).toBe(false);
  });

  it('stops sending once closed, and its snapshot still works', async () => {
    const k = kernel();
    k.spawn({ id: 'A', src: burn });
    const got: InspectMessage[] = [];
    const inspector = k.inspect();
    inspector.on((m) => got.push(m));
    await waitFor(() => ofType(got, 'beats').length >= 1);
    inspector.close();
    const seen = got.length;
    await sleep(1_300);
    expect(got.length).toBe(seen);
    expect(inspector.snapshot().isolates).toHaveLength(1);
  });
});

const feed = () =>
  createInspectFeed({
    isolates: () => [],
    pools: () => [],
    busState: () => 'none',
    tap: () => () => {},
    read: () => Promise.resolve({ ok: true, value: [] }),
    control: () => {},
    workers: () => [],
  });

describe('the feed on its own', () => {
  it('keeps the last 200 events, oldest first, whether inspected or not', () => {
    const f = feed();
    for (let i = 0; i < INSPECT_RING_SIZE + 50; i++)
      f.event('isolate:error', { id: `e${i}`, message: '' });
    const events = f.open().snapshot().events;
    expect(events).toHaveLength(INSPECT_RING_SIZE);
    expect(events[0]?.data['id']).toBe('e50');
    expect(events.at(-1)?.data['id']).toBe(`e${INSPECT_RING_SIZE + 49}`);
  });

  it('runs nothing until a reader listens, and drops beats meanwhile', () => {
    vi.useFakeTimers();
    const f = feed();
    expect(f.live).toBe(false);
    const beat: InspectBeat = { id: 'A', lagMs: 1, at: 0 };
    f.beat(beat);
    const inspector = f.open();
    expect(f.live).toBe(false);
    const got: InspectMessage[] = [];
    const off = inspector.on((m) => got.push(m));
    expect(f.live).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(got).toEqual([]);
    f.beat({ ...beat, lagMs: 2 });
    f.beat({ ...beat, lagMs: 3 });
    vi.advanceTimersByTime(1_000);
    expect(ofType(got, 'beats').map((m) => m.p.beats)).toEqual([[{ ...beat, lagMs: 3 }]]);
    off();
    expect(f.live).toBe(false);
  });

  it('never listens again once the kernel is destroyed', () => {
    const f = feed();
    const inspector = f.open();
    f.destroy();
    inspector.on(() => {});
    expect(f.live).toBe(false);
  });

  it('keeps reporting to other readers when one throws', () => {
    vi.useFakeTimers();
    const f = feed();
    const got: InspectMessage[] = [];
    f.open().on(() => {
      throw new Error('reader bug');
    });
    f.open().on((m) => got.push(m));
    f.event('isolate:error', { id: 'A', message: 'x' });
    expect(got).toHaveLength(1);
    expect(() => vi.runOnlyPendingTimers()).toThrow('reader bug');
  });
});
