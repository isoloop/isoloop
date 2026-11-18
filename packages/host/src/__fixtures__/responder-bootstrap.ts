/// <reference lib="webworker" />
// Test bootstrap for kernel.request (ADR 0018) that speaks the bus protocol
// directly: subscribes to `config.topics` from `committed` and answers each
// request record with what it saw. `config.mode`:
// - `echo` (default): replies at once;
// - `silent`: never replies;
// - `block`: spins forever on the first request;
// - `crash-live`: crashes on a request appended while it was running, and
//   answers one it gets on catch-up after a restart (appended before it started);
// - `die`: crashes at start, every time.
declare const self: DedicatedWorkerGlobalScope;

type Config = { topics?: string[]; mode?: string };
type Msg =
  | {
      t: 'init';
      p: { isolateId: string; config: Config | null; heartbeatMs: number; busPort: MessagePort };
    }
  | { t: 'reattach'; p: { busPort: MessagePort } }
  | { t: 'shutdown' };
type Rec = {
  offset: number;
  ts: number;
  value: { crash?: boolean };
  req?: { from: string; id: string; via?: string };
};
type BusMsg =
  | { t: 'deliver'; p: { topic: string; records: Rec[]; seq: number } }
  | { t: 'reset' | 'result' };

const born = Date.now();
let port: MessagePort | undefined;
let id = '';
let mode = 'echo';
let topics: string[] = [];

const use = (p: MessagePort): void => {
  port?.close();
  port = p;
  p.addEventListener('message', (e: MessageEvent<BusMsg>) => {
    const m = e.data;
    if (m.t !== 'deliver') return;
    for (const r of m.p.records) {
      if (!r.req || mode === 'silent') continue;
      if (mode === 'block') for (;;);
      if (mode === 'crash-live' && r.ts >= born) throw new Error('crashed on a live request');
      const { from, id: reqId, via } = r.req;
      p.postMessage({
        v: 1,
        t: 'reply',
        p: {
          topic: m.p.topic,
          offset: r.offset,
          value: { echo: r.value, from, id: reqId, via: via ?? null, by: id },
        },
      });
    }
    const lastRec = m.p.records.at(-1);
    if (lastRec)
      p.postMessage({
        v: 1,
        t: 'commits',
        p: { offsets: [{ topic: m.p.topic, offset: lastRec.offset, seq: m.p.seq }] },
      });
  });
  p.start();
  for (const topic of topics)
    p.postMessage({ v: 1, t: 'subscribe', p: { topic, from: 'committed' } });
};

self.addEventListener('message', (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.t === 'init') {
    id = m.p.isolateId;
    mode = m.p.config?.mode ?? 'echo';
    topics = m.p.config?.topics ?? [];
    if (mode === 'die') throw new Error('died at start');
    self.postMessage({
      v: 1,
      t: 'ready',
      p: { runtime: 'test', adapter: 'test', renderFmt: 'none' },
    });
    setInterval(() => self.postMessage({ v: 1, t: 'beat', p: { lagMs: 0 } }), m.p.heartbeatMs);
    use(m.p.busPort);
  } else if (m.t === 'reattach') {
    use(m.p.busPort);
  } else if (m.t === 'shutdown') {
    self.postMessage({ v: 1, t: 'bye', p: {} });
    self.close();
  }
});
