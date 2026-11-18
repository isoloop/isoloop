// `ctx.inspector` (ADR 0020, decision 6) against a host end the test drives
// by hand: calls queued until the port arrives, and the controls rejecting
// once the port has ended, while the last snapshot stays readable.
import type { InspectSnapshot, IsolateToInspect } from '@isoloop/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createInspectorClient } from './inspector';

const snap: InspectSnapshot = {
  at: 1,
  isolates: [],
  pools: [],
  bus: { state: 'running', restarts: 0 },
  events: [],
};

/** A host end that answers `snapshot` and `control` at once. */
function fakeHost() {
  const { port1, port2 } = new MessageChannel();
  const got: IsolateToInspect[] = [];
  port1.addEventListener('message', (e: MessageEvent<IsolateToInspect>) => {
    const m = e.data;
    got.push(m);
    if (m.id === undefined) return;
    if (m.t === 'snapshot') port1.postMessage({ v: 1, t: 'snapshot', re: m.id, p: snap });
    else if (m.t === 'control')
      port1.postMessage({ v: 1, t: 'result', re: m.id, p: { ok: true, value: null } });
  });
  port1.start();
  return { port: port2, got };
}

describe('ctx.inspector', () => {
  it('queues what it is asked until the port arrives', async () => {
    const c = createInspectorClient();
    const asked = c.inspector.snapshot();
    const host = fakeHost();
    c.attach(host.port);
    await expect(asked).resolves.toEqual(snap);
    await expect(c.inspector.kill('T')).resolves.toBeUndefined();
    expect(host.got.map((m) => m.t)).toEqual(['snapshot', 'control']);
  });

  it('rejects its controls once the port has ended, and keeps the last snapshot', async () => {
    const c = createInspectorClient();
    const host = fakeHost();
    c.attach(host.port);
    await c.inspector.snapshot();
    c.end();
    await expect(c.inspector.restart('T')).rejects.toThrow(/ended/);
    await expect(c.inspector.kill('T')).rejects.toThrow(/ended/);
    await expect(c.inspector.block('T', 100)).rejects.toThrow(/ended/);
    await expect(c.inspector.snapshot()).resolves.toEqual(snap);
    await vi.waitFor(() => {
      expect(host.got.filter((m) => m.t === 'control')).toHaveLength(0);
    });
  });

  it('rejects calls still waiting when the port ends', async () => {
    const c = createInspectorClient();
    const { port1, port2 } = new MessageChannel();
    port1.start(); // a host that never answers
    c.attach(port2);
    const waiting = c.inspector.kill('T');
    c.end();
    await expect(waiting).rejects.toThrow(/ended/);
    await expect(c.inspector.snapshot()).rejects.toThrow(/ended/);
  });
});
