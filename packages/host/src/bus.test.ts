// The bus controller against the real bus worker (plan m2-bus task 8).
// Isolates run a test bootstrap that speaks the bus protocol directly.
import type { BusRecord } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, notes, report, saved, type Report } from './__fixtures__/contracts';
import { BusError, createKernel, type Kernel, type KernelConfig, type KernelEvents } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const busWorker = worker('../../bus/src/worker.ts');
const bootstrap = worker('./__fixtures__/bus-bootstrap.ts');
const contractsUrl = new URL('./__fixtures__/contracts.ts', import.meta.url).href;
const src = new URL('./__fixtures__/throws.ts', import.meta.url).href; // never imported by the test bootstrap

const ALL = { publish: ['*'], subscribe: ['*'] };

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
  // Persistent topics live in this origin's OPFS: start every test empty. A
  // terminated bus worker may hold its files a moment longer.
  const origin = await navigator.storage.getDirectory();
  await vi.waitUntil(() =>
    origin.removeEntry('isoloop', { recursive: true }).then(
      () => true,
      (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError',
    ),
  );
});

function setup(extra: Partial<KernelConfig> = {}) {
  const kernel = createKernel({
    contracts: { url: contractsUrl, list },
    workers: { isolateBootstrap: bootstrap, bus: busWorker },
    supervisor: { backoff: { initialMs: 50 } },
    ...extra,
  });
  kernels.push(kernel);
  const log = <E extends keyof KernelEvents>(e: E): KernelEvents[E][] => {
    const got: KernelEvents[E][] = [];
    kernel.on(e, (x) => got.push(x));
    return got;
  };
  const reports: Report[] = [];
  kernel.subscribe(report, (r) => reports.push(r.value), { from: 'earliest' });
  const latest = (id: string): Report | undefined => {
    for (let i = reports.length - 1; i >= 0; i--) if (reports[i]?.id === id) return reports[i];
    return undefined;
  };
  return { kernel, log, reports, latest };
}

/** CRC-32 (IEEE), as the bus's frames use. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffff_ffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffff_ffff) >>> 0;
}

/** A segment frame at `offset` whose body is a codec tag that doesn't exist. */
function poisonFrame(offset: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8 + 8 + 1);
  const view = new DataView(out.buffer);
  view.setUint32(0, 9, true);
  view.setFloat64(8, offset, true);
  out[16] = 0xd1;
  view.setUint32(4, crc32(out.subarray(8)), true);
  return out;
}

describe('bus controller', () => {
  it('starts the bus, wires isolates to it, and carries kernel.publish / kernel.subscribe', async () => {
    const { kernel, log, latest } = setup();
    const ready = log('bus:ready');
    kernel.spawn({ id: 'X', src, grants: ALL, config: { topics: ['count.v1'] } });
    const got: BusRecord[] = [];
    kernel.subscribe(count, (r) => got.push(r), { from: 'earliest' });
    await kernel.publish(count, { key: 'k', value: 41 });
    await vi.waitUntil(() => got.length === 1);
    expect(got[0]).toMatchObject({ offset: 0, key: 'k', value: 41, producer: 'host' });
    expect(ready).toEqual([{ first: true }]);
    // The isolate's subscription got it too, on its own port.
    await vi.waitUntil(() => latest('X')?.seen === 0);
  });

  it('rejects isoloop.* and invalid publishes with a BusError', async () => {
    const { kernel } = setup();
    const route = { ...notes, name: 'isoloop.route.v1' };
    await expect(kernel.publish(route, { value: 'x' })).rejects.toMatchObject({
      name: 'BusError',
      code: 'forbidden',
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a wrong value on purpose
    const bad = kernel.publish(count, { value: 'nope' as unknown as number });
    await expect(bad).rejects.toBeInstanceOf(BusError);
    await expect(bad).rejects.toMatchObject({ code: 'invalid' });
  });

  it('a bus crash reattaches running isolates: no restart, one reset per memory topic (I11)', async () => {
    const { kernel, log, latest } = setup();
    const states = log('isolate:state');
    const crash = log('bus:crash');
    const restart = log('bus:restart');
    const ready = log('bus:ready');
    kernel.spawn({ id: 'X', src, grants: ALL, config: { topics: ['count.v1', 'notes.v1'] } });
    kernel.spawn({
      id: 'Y',
      src,
      grants: ALL,
      config: { topics: ['count.v1'] },
      bus: { onReset: 'restart' },
    });
    await vi.waitUntil(() => latest('X') && latest('Y') && ready.length === 1);
    await vi.waitUntil(() => kernel.isolates().every((s) => s.state === 'running'));
    states.length = 0;

    kernel.debug.crashBus();
    await vi.waitUntil(() => ready.length === 2, { timeout: 3000 });
    expect(crash).toMatchObject([{ reason: 'worker-error' }]);
    expect(restart).toEqual([{ restarts: 1 }]);
    expect(ready[1]).toEqual({ first: false });

    await vi.waitUntil(
      () => latest('X')?.ports === 2 && Object.keys(latest('X')?.resets ?? {}).length === 2,
    );
    expect(latest('X')?.resets).toEqual({ 'count.v1': 1, 'notes.v1': 1 });
    // X never left `running`; Y asked to be restarted instead of reset.
    expect(states.filter((s) => s.id === 'X')).toEqual([]);
    expect(states.filter((s) => s.id === 'Y').map((s) => s.state)).toContain('restarting');
    await vi.waitUntil(() => kernel.isolates().every((s) => s.state === 'running'));
    // A fresh Y on the new bus: one port, no reset.
    await vi.waitUntil(
      () => latest('Y')?.ports === 1 && latest('Y')?.resets['count.v1'] === undefined,
    );

    // The bus works after the restart, for host and isolates.
    const got: number[] = [];
    kernel.subscribe(count, (r) => got.push(r.value), { from: 'earliest' });
    await kernel.publish(count, { value: 7 });
    await vi.waitUntil(() => got.includes(7));
  });

  it('a persistent topic survives a bus crash: no reset, no gap, every acked record (M2b)', async () => {
    const { kernel, log, latest } = setup();
    const ready = log('bus:ready');
    kernel.spawn({ id: 'X', src, grants: ALL, config: { topics: ['saved.v1', 'count.v1'] } });
    await vi.waitUntil(() => latest('X') && ready.length === 1);
    // Sent in order on one port, so offsets follow i.
    await Promise.all(Array.from({ length: 20 }, (_, i) => kernel.publish(saved, { value: i })));
    await kernel.publish(count, { value: 1 });
    await vi.waitUntil(() => latest('X')?.offsets['saved.v1']?.length === 20);

    kernel.debug.crashBus();
    await vi.waitUntil(() => ready.length === 2, { timeout: 3000 });
    // The memory topic is reset once; the persistent one resumes where X committed.
    await vi.waitUntil(() => latest('X')?.ports === 2 && latest('X')?.resets['count.v1'] === 1);
    await Promise.all([20, 21, 22, 23, 24].map((i) => kernel.publish(saved, { value: i })));
    await vi.waitUntil(() => latest('X')?.offsets['saved.v1']?.length === 25);
    const x = latest('X');
    expect(x?.resets['saved.v1']).toBeUndefined();
    expect(x?.gaps).toBe(0);
    expect(x?.offsets['saved.v1']).toEqual(Array.from({ length: 25 }, (_, i) => i));

    // And the host reads the whole log back from the new bus.
    const got: number[] = [];
    kernel.subscribe(saved, (r) => got.push(r.value), { from: 'earliest' });
    await vi.waitUntil(() => got.length === 25);
    expect(got).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('safe mode: a stored record that crashes the bus twice while loading is set aside (M2b)', async () => {
    const first = setup();
    const ready = first.log('bus:ready');
    await vi.waitUntil(() => ready.length === 1);
    await Promise.all([0, 1, 2].map((i) => first.kernel.publish(saved, { value: i })));
    await first.kernel.destroy();

    // A record the codec can't read, with a valid CRC, after the three: the
    // restore throws on it every time.
    const dir = await (
      await (await navigator.storage.getDirectory()).getDirectoryHandle('isoloop')
    )
      .getDirectoryHandle('topics')
      .then((d) => d.getDirectoryHandle('saved.v1'));
    const segment = await dir.getFileHandle('0000000000000000.seg');
    const writable = await vi.waitUntil(() =>
      segment.createWritable({ keepExistingData: true }).catch(() => undefined),
    );
    await writable.seek((await segment.getFile()).size);
    await writable.write(poisonFrame(3));
    await writable.close();

    const second = setup();
    const crashes = second.log('bus:crash');
    const recovered = second.log('bus:recovered');
    const ready2 = second.log('bus:ready');
    await vi.waitUntil(() => recovered.length === 1, { timeout: 10_000 });
    expect(recovered[0]).toEqual({ quarantined: ['saved.v1/0000000000000000.seg'] });
    expect(crashes.length).toBe(2);
    await vi.waitUntil(() => ready2.length === 1);

    // Set aside, not deleted; and its offsets aren't handed out again (I5).
    const names: string[] = [];
    for await (const name of dir.keys()) names.push(name);
    expect(names).toContain('0000000000000000.seg.to-0000000000000004.quarantined');
    await second.kernel.publish(saved, { value: 9 });
    const got: BusRecord[] = [];
    second.kernel.subscribe(saved, (r) => got.push(r), { from: 'earliest' });
    await vi.waitUntil(() => got.length === 1);
    expect(got.map((r) => [r.offset, r.value])).toEqual([[4, 9]]);
  });

  it('one bus owns the files: a second runs in memory with bus:durability-degraded (M2b)', async () => {
    const a = setup();
    const aDegraded = a.log('bus:durability-degraded');
    const aReady = a.log('bus:ready');
    await vi.waitUntil(() => aReady.length === 1);
    await a.kernel.publish(saved, { value: 1 });

    const b = setup();
    const bDegraded = b.log('bus:durability-degraded');
    const bReady = b.log('bus:ready');
    await vi.waitUntil(() => bReady.length === 1);
    expect(bDegraded).toEqual([{ reason: 'another-tab' }]);
    expect(aDegraded).toEqual([]);
    // It works, in memory.
    await b.kernel.publish(saved, { value: 2 });
    const got: number[] = [];
    b.kernel.subscribe(saved, (r) => got.push(r.value), { from: 'earliest' });
    await vi.waitUntil(() => got.length === 1);
    expect(got).toEqual([2]);

    // A bus restart in the owning kernel keeps the files: it waits for the lock.
    a.kernel.debug.crashBus();
    await vi.waitUntil(() => aReady.length === 2, { timeout: 5000 });
    expect(aDegraded).toEqual([]);
  });

  it('a contracts mismatch is fatal: bus:failed, isolates fail, spawn throws', async () => {
    const differ = { ...list, topics: list.topics.filter((t) => t.name !== 'notes.v1') };
    const { kernel, log } = setup({ contracts: { url: contractsUrl, list: differ } });
    const failed = log('bus:failed');
    const isoFailed = log('isolate:failed');
    kernel.spawn({ id: 'X', src, grants: ALL });
    await vi.waitUntil(() => failed.length === 1);
    expect(failed[0]).toMatchObject({ code: 'contracts_mismatch' });
    expect(failed[0]?.message).toContain('notes.v1');
    await vi.waitUntil(() => isoFailed.length === 1);
    expect(isoFailed[0]).toMatchObject({ id: 'X', reason: 'bus-failed' });
    expect(() => kernel.spawn({ id: 'Z', src })).toThrow(
      expect.objectContaining({ code: 'bus_failed' }),
    );
    await expect(kernel.publish(count, { value: 1 })).rejects.toMatchObject({
      code: 'bus_unavailable',
    });
  });

  it('past the restart limit the bus fails for good, and publishes reject with bus_unavailable', async () => {
    const { kernel, log, latest } = setup({
      supervisor: { maxRestarts: 1, backoff: { initialMs: 20 } },
    });
    const failed = log('bus:failed');
    const ready = log('bus:ready');
    kernel.spawn({ id: 'X', src, grants: ALL, config: { topics: [] } });
    await vi.waitUntil(() => ready.length === 1 && latest('X'));
    kernel.debug.crashBus();
    await vi.waitUntil(() => ready.length === 2, { timeout: 3000 });
    kernel.debug.crashBus();
    await vi.waitUntil(() => failed.length === 1);
    expect(failed[0]).toMatchObject({ reason: 'worker-error' });
    await expect(kernel.publish(count, { value: 1 })).rejects.toMatchObject({
      code: 'bus_unavailable',
    });
    expect(kernel.isolates()[0]?.state).toBe('running');
  });

  it('rejects isolate ids in the kernel namespace', () => {
    const { kernel } = setup();
    expect(() => kernel.spawn({ id: 'isoloop:host:1', src })).toThrow(
      expect.objectContaining({ code: 'invalid_manifest' }),
    );
  });

  it('needs contracts and workers.bus together', () => {
    expect(() =>
      createKernel({ workers: { isolateBootstrap: bootstrap, bus: busWorker } }),
    ).toThrow(expect.objectContaining({ code: 'invalid_config' }));
  });
});
