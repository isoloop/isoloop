// The `inspect` grant and its port (ADR 0020, decision 6): `ctx.inspector`
// against real workers and the real bus, the controls, and the host
// `Inspector`'s tap, records and controls.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list, { count, report } from '../__fixtures__/contracts';
import { createKernel, KernelError, type Kernel, type KernelEvents } from '../index';

const worker = (path: string): string =>
  `${new URL(path, import.meta.url).href}?worker_file&type=module`;
const bootstrap = worker('../../../runtime/src/bootstrap.ts');
const busWorker = worker('../../../bus/src/worker.ts');
const contractsUrl = new URL('../__fixtures__/contracts.ts', import.meta.url).href;
const inspectorSrc = new URL('../__fixtures__/inspector.ts', import.meta.url).href;
const burn = new URL('../__fixtures__/burn.ts', import.meta.url).href;

const kernels: Kernel[] = [];
afterEach(async () => {
  await Promise.all(kernels.splice(0).map((k) => k.destroy()));
});

function kernel(): Kernel {
  const k = createKernel({
    workers: { isolateBootstrap: bootstrap, bus: busWorker },
    contracts: { url: contractsUrl, list },
    supervisor: { maxRestarts: 5, backoff: { initialMs: 20 } },
    heartbeat: { everyMs: 50, blockedAfterMs: 200, killAfterMs: 600 },
  });
  kernels.push(k);
  return k;
}

const waitFor = (ok: () => boolean, timeout = 8000) =>
  vi.waitFor(
    () => {
      if (!ok()) throw new Error('not yet');
    },
    { timeout, interval: 20 },
  );

type Seen = { step: string; data: unknown };

/** Spawns the inspector fixture and collects what it reports. */
function inspectorIsolate(k: Kernel, config: Record<string, unknown>, inspect = true): Seen[][] {
  const reports: Seen[][] = [];
  k.subscribe(
    report,
    (r) => {
      const v: unknown = r.value;
      if (typeof v === 'object' && v !== null && 'seen' in v && Array.isArray(v.seen))
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture's report shape
        reports.push(v.seen as Seen[]);
    },
    { from: 'earliest' },
  );
  k.spawn({
    id: 'devtools',
    src: inspectorSrc,
    grants: { publish: [report.name], subscribe: [], inspect },
    config,
  });
  return reports;
}

const latest = (reports: Seen[][]): Seen[] => reports.at(-1) ?? [];
const step = (reports: Seen[][], name: string): Seen | undefined =>
  latest(reports).find((s) => s.step === name);

describe('the inspect grant (ADR 0020, decision 6)', () => {
  it('leaves ctx.inspector undefined without the grant', async () => {
    const k = kernel();
    const reports = inspectorIsolate(k, {}, false);
    await waitFor(() => step(reports, 'none') !== undefined);
  });

  it('refuses an isolate holding it in a pool, with invalid_config', () => {
    const k = kernel();
    let err: unknown;
    try {
      k.spawn({
        id: 'pooled',
        src: burn,
        pool: 'p',
        grants: { publish: [], subscribe: [], inspect: true },
      });
    } catch (e) {
      err = e;
    }
    expect(err instanceof KernelError && err.code).toBe('invalid_config');
    expect(k.isolates().map((i) => i.id)).not.toContain('pooled');
  });

  it('gives the isolate a snapshot over its port', async () => {
    const k = kernel();
    k.spawn({ id: 'T', src: burn });
    const reports = inspectorIsolate(k, { do: 'snapshot' });
    await waitFor(() => step(reports, 'snapshot') !== undefined);
    const data: unknown = step(reports, 'snapshot')?.data;
    const ids: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'ids') : [];
    expect(ids).toEqual(['T', 'devtools']);
    expect(typeof data === 'object' && data !== null && Reflect.get(data, 'restarts')).toBe(0);
  });

  it('keeps feeding the isolate while the bus restarts', async () => {
    const k = kernel();
    const reports = inspectorIsolate(k, { do: 'listen' });
    await waitFor(() => step(reports, 'listening') !== undefined);
    await waitFor(() => latest(reports).some((s) => s.step === 'metrics'));
    k.debug.crashBus();
    // The restart reaches the isolate over its own port, not the bus; its
    // reports come through once the bus is back.
    await waitFor(() =>
      latest(reports).some((s) => s.step === 'event' && s.data === 'bus:restart'),
    );
    const before = latest(reports).filter((s) => s.step === 'metrics').length;
    await waitFor(() => latest(reports).filter((s) => s.step === 'metrics').length > before + 1);
  });

  it('reads past records and taps new ones as previews', async () => {
    const k = kernel();
    // In order, so the last three are known.
    await [1, 2, 3, 4].reduce((prev, n) => prev.then(() => k.publish(count, n)), Promise.resolve());
    const read = inspectorIsolate(k, { do: 'records' });
    await waitFor(() => step(read, 'records') !== undefined);
    expect(step(read, 'records')?.data).toEqual(['2', '3', '4']);
  });

  it('taps records appended after it opens', async () => {
    const k = kernel();
    const reports = inspectorIsolate(k, { do: 'tap' });
    await waitFor(() => step(reports, 'tapping') !== undefined);
    await vi.waitFor(
      async () => {
        await k.publish(count, 42);
        if (!latest(reports).some((s) => s.step === 'tapped' && s.data === '42'))
          throw new Error('not yet');
      },
      { timeout: 8000, interval: 200 },
    );
  });
});

describe("a tap's skipped count (ADR 0020, decision 6, amended 2026-11-19)", () => {
  it('reaches ctx.inspector through onSkipped', async () => {
    const k = kernel();
    const reports = inspectorIsolate(k, { do: 'tap-skipped' });
    await waitFor(() => step(reports, 'tapping') !== undefined);
    await vi.waitFor(
      async () => {
        await Promise.all(Array.from({ length: 20 }, (_, i) => k.publish(count, i)));
        const s = step(reports, 'skipped');
        if (typeof s?.data !== 'number' || s.data < 1) throw new Error('not yet');
      },
      { timeout: 8000, interval: 300 },
    );
  });

  it('reaches the host Inspector through onSkipped', async () => {
    const k = kernel();
    k.spawn({ id: 'T', src: burn });
    await waitFor(() => k.isolates().find((i) => i.id === 'T')?.state === 'running');
    const ins = k.inspect();
    let skipped = 0;
    let seen = 0;
    const stop = ins.tap(
      {
        topics: [count.name],
        maxPerSec: 1,
        onSkipped: (n) => {
          skipped += n;
        },
      },
      () => {
        seen++;
      },
    );
    await vi.waitFor(
      async () => {
        await Promise.all(Array.from({ length: 20 }, (_, i) => k.publish(count, i)));
        if (skipped < 1) throw new Error('not yet');
      },
      { timeout: 8000, interval: 300 },
    );
    expect(seen).toBeGreaterThan(0);
    stop();
    ins.close();
  });
});

const crashes = (k: Kernel) => {
  const got: KernelEvents['isolate:crash'][] = [];
  k.on('isolate:crash', (e) => got.push(e));
  return got;
};

describe('the controls over the port', () => {
  it('kill ends the worker as a crash, and the supervisor restarts it', async () => {
    const k = kernel();
    const got = crashes(k);
    k.spawn({ id: 'T', src: burn });
    await waitFor(() => k.isolates().find((i) => i.id === 'T')?.state === 'running');
    const reports = inspectorIsolate(k, { do: 'control', action: 'kill', target: 'T' });
    await waitFor(() => step(reports, 'done') !== undefined);
    await waitFor(() => got.some((e) => e.id === 'T' && e.reason === 'worker_error'));
    await waitFor(() => {
      const t = k.isolates().find((i) => i.id === 'T');
      return t?.state === 'running' && t.restarts === 1;
    });
  });

  it('block makes the beat late, and the supervisor acts', async () => {
    const k = kernel();
    const got = crashes(k);
    const states: string[] = [];
    k.on('isolate:state', (e) => {
      if (e.id === 'T') states.push(e.state);
    });
    k.spawn({ id: 'T', src: burn });
    await waitFor(() => k.isolates().find((i) => i.id === 'T')?.state === 'running');
    const reports = inspectorIsolate(k, { do: 'control', action: 'block', target: 'T', ms: 2000 });
    await waitFor(() => step(reports, 'done') !== undefined);
    await waitFor(() => states.includes('blocked'));
    await waitFor(() => got.some((e) => e.id === 'T' && e.reason === 'unresponsive'));
  });

  it('restart restarts the isolate, as kernel.restart does', async () => {
    const k = kernel();
    const states: string[] = [];
    k.on('isolate:state', (e) => {
      if (e.id === 'T') states.push(e.state);
    });
    k.spawn({ id: 'T', src: burn });
    await waitFor(() => k.isolates().find((i) => i.id === 'T')?.state === 'running');
    const reports = inspectorIsolate(k, { do: 'control', action: 'restart', target: 'T' });
    await waitFor(() => step(reports, 'done') !== undefined);
    await waitFor(() => states.includes('restarting'));
    await waitFor(() => k.isolates().find((i) => i.id === 'T')?.state === 'running');
  });

  it('answers an unknown isolate with an error', async () => {
    const k = kernel();
    const reports = inspectorIsolate(k, { do: 'control', action: 'kill', target: 'nobody' });
    await waitFor(() => step(reports, 'error') !== undefined);
  });
});

describe('the host Inspector', () => {
  it('reads, taps and controls like the port', async () => {
    const k = kernel();
    k.spawn({ id: 'T', src: burn });
    await waitFor(() => k.isolates().find((i) => i.id === 'T')?.state === 'running');
    const ins = k.inspect();
    await k.publish(count, 7);
    const recs = await ins.records(count.name, { last: 5 });
    expect(recs.map((r) => r.preview)).toEqual(['7']);
    const tapped: string[] = [];
    const stop = ins.tap({ topics: [count.name] }, (r) => tapped.push(r.preview));
    await vi.waitFor(
      async () => {
        await k.publish(count, 8);
        if (!tapped.includes('8')) throw new Error('not yet');
      },
      { timeout: 8000, interval: 200 },
    );
    stop();
    await ins.kill('T');
    await waitFor(() => {
      const t = k.isolates().find((i) => i.id === 'T');
      return t?.state === 'running' && t.restarts === 1;
    });
    await expect(ins.restart('nobody')).rejects.toThrow();
    ins.close();
  });

  it('rejects its controls after close(), and keeps snapshot() readable', async () => {
    const k = kernel();
    k.spawn({ id: 'T', src: burn });
    await waitFor(() => k.isolates().find((i) => i.id === 'T')?.state === 'running');
    const ins = k.inspect();
    ins.close();
    await expect(ins.restart('T')).rejects.toThrow(/closed/);
    await expect(ins.kill('T')).rejects.toThrow(/closed/);
    await expect(ins.block('T', 100)).rejects.toThrow(/closed/);
    expect(ins.snapshot().isolates.map((i) => i.id)).toEqual(['T']);
    const t = k.isolates().find((i) => i.id === 'T');
    expect(t?.state).toBe('running');
    expect(t?.restarts).toBe(0);
  });

  it('kill on a pooled isolate restarts every member of the pool', async () => {
    const k = kernel();
    const got = crashes(k);
    k.spawn({ id: 'P1', src: burn, pool: 'p' });
    k.spawn({ id: 'P2', src: burn, pool: 'p' });
    await waitFor(() => k.isolates().every((i) => i.state === 'running'));
    await k.inspect().kill('P1');
    await waitFor(() => ['P1', 'P2'].every((id) => got.some((e) => e.id === id)));
    await waitFor(() => k.isolates().every((i) => i.state === 'running' && i.restarts === 1));
  });
});
