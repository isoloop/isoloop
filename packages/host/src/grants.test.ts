// I4 (design §8) through the real wiring: manifest grants → kernel → `attach`
// → the bus worker's checks, with the real runtime and BusClient. The broker's
// unit tests cover the rules; this covers the grants reaching them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, notes, report } from './__fixtures__/contracts';
import { createKernel, type Kernel, type KernelEvents } from './index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const src = new URL('./__fixtures__/grants.ts', import.meta.url).href;

type Seen = { id: string; seen: string[]; published: Record<string, string> };
const isSeen = (v: unknown): v is Seen =>
  typeof v === 'object' && v !== null && 'seen' in v && 'published' in v;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

describe('grants (I4)', () => {
  it('an isolate can only publish and receive the topics its manifest grants', async () => {
    const kernel = createKernel({
      contracts: { url: new URL('./__fixtures__/contracts.ts', import.meta.url).href, list },
      workers: {
        isolateBootstrap: worker('../../runtime/src/bootstrap.ts'),
        bus: worker('../../bus/src/worker.ts'),
      },
    });
    kernels.push(kernel);
    const reports: Seen[] = [];
    kernel.subscribe(report, (r) => {
      if (isSeen(r.value)) reports.push(r.value);
    });
    const latest = (id: string): Seen | undefined => {
      for (let i = reports.length - 1; i >= 0; i--) if (reports[i]?.id === id) return reports[i];
      return undefined;
    };
    const errors: KernelEvents['isolate:error'][] = [];
    kernel.on('isolate:error', (e) => errors.push(e));

    // G may do everything it tries; U may only read count.v1 and write its reports.
    kernel.spawn({
      id: 'G',
      src,
      grants: {
        publish: ['count.v1', 'notes.v1', 'report.v1'],
        subscribe: ['count.v1', 'notes.v1'],
      },
    });
    kernel.spawn({ id: 'U', src, grants: { publish: ['report.v1'], subscribe: ['count.v1'] } });

    await vi.waitUntil(
      () => latest('G')?.published['notes.v1'] && latest('U')?.published['notes.v1'],
      {
        timeout: 5000,
      },
    );
    expect(latest('U')?.published).toEqual({ 'count.v1': 'forbidden', 'notes.v1': 'forbidden' });
    expect(latest('G')?.published).toEqual({ 'count.v1': 'ok', 'notes.v1': 'ok' });

    // The refused subscription reaches the host as a non-fatal isolate error.
    await vi.waitUntil(() => errors.some((e) => e.id === 'U'), { timeout: 5000 });
    expect(errors.filter((e) => e.id === 'U').map((e) => e.message)).toEqual([
      expect.stringMatching(/no subscribe grant for notes\.v1/),
    ]);
    expect(errors.filter((e) => e.id === 'G')).toEqual([]);

    // Records on both topics: U gets count.v1 only, G gets both.
    await kernel.publish(notes, { value: 'host note' });
    await kernel.publish(count, { value: 7 });
    await vi.waitUntil(() => latest('U')?.seen.includes('count.v1:7'), { timeout: 5000 });
    await vi.waitUntil(() => latest('G')?.seen.includes('count.v1:7'), { timeout: 5000 });
    expect(latest('G')?.seen).toContain('notes.v1:host note');
    expect(latest('U')?.seen.filter((s) => s.startsWith('notes.v1'))).toEqual([]);
    expect(kernel.isolates().map((s) => [s.id, s.state])).toEqual([
      ['G', 'running'],
      ['U', 'running'],
    ]);
  });
});
