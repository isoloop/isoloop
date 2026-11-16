import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKernel, type Kernel, type KernelEvents } from './index';

// `isolate:beat` (ADR 0017): every heartbeat, per member, as it arrives.

const bootstrap = `${new URL('../../runtime/src/bootstrap.ts', import.meta.url).href}?worker_file&type=module`;
const burn = new URL('./__fixtures__/burn.ts', import.meta.url).href;

type Beat = KernelEvents['isolate:beat'];

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function kernel(): Kernel {
  const k = createKernel({ workers: { isolateBootstrap: bootstrap } });
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

const sum = (beats: Beat[], id: string): number =>
  beats.filter((b) => b.id === id).reduce((n, b) => n + (b.busyMs ?? 0), 0);

describe('isolate:beat (ADR 0017)', () => {
  it('reports each beat of an own worker, with its lag and busy time', async () => {
    const k = kernel();
    const beats: Beat[] = [];
    k.on('isolate:beat', (b) => beats.push(b));
    k.spawn({ id: 'A', src: burn, config: { burnMs: 2 } });
    await waitFor(() => beats.filter((b) => b.id === 'A').length >= 5);
    const a = beats.filter((b) => b.id === 'A');
    for (const b of a) {
      expect(b.pool).toBeUndefined();
      expect(typeof b.lagMs).toBe('number');
      expect(typeof b.busyMs).toBe('number');
      expect(typeof b.at).toBe('number');
    }
    // Arrival order: `at` never goes backwards.
    for (let i = 1; i < a.length; i++) expect(a[i]!.at).toBeGreaterThanOrEqual(a[i - 1]!.at);
  });

  it('gives one event per pool member, each with its own busy time', async () => {
    const k = kernel();
    const beats: Beat[] = [];
    k.on('isolate:beat', (b) => beats.push(b));
    k.spawn({ id: 'heavy', src: burn, pool: 'p', config: { burnMs: 4 } });
    k.spawn({ id: 'light', src: burn, pool: 'p', config: { burnMs: 0 } });
    await waitFor(() => beats.filter((b) => b.id === 'light').length >= 10);
    beats.length = 0;
    await waitFor(() => beats.filter((b) => b.id === 'light').length >= 10);
    expect(beats.every((b) => b.pool === 'p')).toBe(true);
    // Same worker, same beat: as many events for each member.
    const n = (id: string) => beats.filter((b) => b.id === id).length;
    expect(Math.abs(n('heavy') - n('light'))).toBeLessThanOrEqual(1);
    expect(sum(beats, 'heavy')).toBeGreaterThan(4 * sum(beats, 'light'));
  });

  it('stops reporting to a listener once it unsubscribes', async () => {
    const k = kernel();
    const beats: Beat[] = [];
    const off = k.on('isolate:beat', (b) => beats.push(b));
    k.spawn({ id: 'A', src: burn });
    await waitFor(() => beats.length >= 2);
    off();
    const seen = beats.length;
    await new Promise((r) => {
      setTimeout(r, 400);
    });
    expect(beats.length).toBe(seen);
  });
});
