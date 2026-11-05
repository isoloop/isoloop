/// <reference lib="webworker" />
// Test bootstrap that speaks the bus protocol directly, before the runtime's
// BusClient exists: a headless isolate that subscribes to `config.topics`,
// commits what it gets, swaps its port on `reattach`, and publishes a
// `report.v1` record whenever something changes.
declare const self: DedicatedWorkerGlobalScope;

type Msg =
  | {
      t: 'init';
      p: {
        isolateId: string;
        config: { topics?: string[] } | null;
        heartbeatMs: number;
        busPort: MessagePort;
      };
    }
  | { t: 'reattach'; p: { busPort: MessagePort } }
  | { t: 'shutdown' };

type BusMsg =
  | { t: 'reset'; p: { topic: string } }
  | { t: 'deliver'; p: { topic: string; records: { offset: number }[] } }
  | { t: 'result' };

let port: MessagePort | undefined;
let id = '';
let topics: string[] = [];
const resets: Record<string, number> = {};
let ports = 0;
let seen = 0;
let n = 0;

const report = (): void => {
  port?.postMessage({
    v: 1,
    t: 'publish',
    id: `r${++n}`,
    p: { topic: 'report.v1', value: { id, resets: { ...resets }, ports, seen } },
  });
};

const use = (p: MessagePort): void => {
  port?.close();
  port = p;
  ports++;
  p.addEventListener('message', (e: MessageEvent<BusMsg>) => {
    const m = e.data;
    if (m.t === 'reset') {
      resets[m.p.topic] = (resets[m.p.topic] ?? 0) + 1;
      report();
    } else if (m.t === 'deliver') {
      seen += m.p.records.length;
      const last = m.p.records.at(-1);
      if (last) p.postMessage({ v: 1, t: 'commit', p: { topic: m.p.topic, offset: last.offset } });
    }
  });
  p.start();
  for (const topic of topics)
    p.postMessage({ v: 1, t: 'subscribe', p: { topic, from: 'committed' } });
  report();
};

self.addEventListener('message', (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.t === 'init') {
    const { p } = m;
    id = p.isolateId;
    topics = p.config?.topics ?? [];
    self.postMessage({
      v: 1,
      t: 'ready',
      p: { runtime: 'test', adapter: 'test', renderFmt: 'none' },
    });
    setInterval(() => self.postMessage({ v: 1, t: 'beat', p: { lagMs: 0 } }), p.heartbeatMs);
    use(p.busPort);
  } else if (m.t === 'reattach') {
    use(m.p.busPort);
  } else if (m.t === 'shutdown') {
    self.postMessage({ v: 1, t: 'bye', p: {} });
    self.close();
  }
});
