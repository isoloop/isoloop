// Test isolate for a stop followed at once by a spawn with the same id, on
// the real runtime. Subscribes to count.v1 from `earliest`, reports every
// value it sees on report.v1 under `config.instance`, renders the last value
// when it has a surface, and with `config.slowStopMs` takes that long to shut
// down, so its `bye` comes after the next instance has started.
import { count, report } from './contracts';

type Rec = { value: unknown };
type Ctx = {
  id: string;
  config: unknown;
  root?: Element;
  onShutdown(fn: () => Promise<void>): void;
  bus: {
    publish(topic: unknown, rec: { value: unknown }): Promise<void>;
    subscribe(topic: unknown, fn: (r: Rec) => void, opts?: { from?: string }): () => void;
  };
};

type Config = { instance: string; slowStopMs?: number };

const isConfig = (c: unknown): c is Config =>
  typeof c === 'object' && c !== null && 'instance' in c && typeof c.instance === 'string';

export default {
  start(ctx: Ctx): void {
    if (!isConfig(ctx.config)) throw new Error('respawned: config.instance missing');
    const { instance, slowStopMs = 0 } = ctx.config;
    const values: unknown[] = [];
    const out = ctx.root ? document.createElement('p') : undefined;
    if (out && ctx.root) {
      out.setAttribute('class', 'value');
      out.setAttribute('data-instance', instance);
      out.textContent = '-';
      ctx.root.append(out);
    }
    const send = (): void => {
      void ctx.bus.publish(report, { value: { id: ctx.id, instance, values: [...values] } });
    };
    ctx.bus.subscribe(
      count,
      (r) => {
        values.push(r.value);
        if (out) out.textContent = String(r.value);
        send();
      },
      { from: 'earliest' },
    );
    ctx.onShutdown(
      () =>
        new Promise((r) => {
          setTimeout(r, slowStopMs);
        }),
    );
    send();
  },
};
