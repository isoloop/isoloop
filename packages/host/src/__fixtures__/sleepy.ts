// Test isolate for suspension (ADR 0001), on the real runtime. Subscribes to
// `config.topic` (from `latest`, optionally in `config.group`), reports every
// record and gap it sees on report.v1 with a per-start instance id, renders
// the values when it has a surface, and with `config.hold` keeps a
// keepAwake() hold until a record on notes.v1 arrives.
import { notes, report } from './contracts';

type Rec = { offset: number; key?: string; value: unknown };
type Ctx = {
  id: string;
  config: unknown;
  root?: Element;
  keepAwake(): () => void;
  bus: {
    publish(topic: unknown, rec: { value: unknown }): Promise<void>;
    subscribe(
      topic: unknown,
      fn: (r: Rec) => void,
      opts?: { from?: string; group?: string; onGap?: (g: { from: number; to: number }) => void },
    ): () => void;
  };
};

type Config = { topic: string; group?: string; hold?: boolean };

const isConfig = (c: unknown): c is Config =>
  typeof c === 'object' && c !== null && 'topic' in c && typeof c.topic === 'string';

export default {
  start(ctx: Ctx): void {
    if (!isConfig(ctx.config)) throw new Error('sleepy: config.topic missing');
    const config = ctx.config;
    const instance = Math.random().toString(36).slice(2);
    const values: unknown[] = [];
    const keys: string[] = [];
    const gaps: { from: number; to: number }[] = [];
    const out = ctx.root ? document.createElement('p') : undefined;
    if (out && ctx.root) {
      out.setAttribute('class', 'values');
      ctx.root.append(out);
    }
    const send = (): void => {
      if (out) out.textContent = values.join(',');
      void ctx.bus.publish(report, {
        value: { id: ctx.id, instance, values: [...values], keys: [...keys], gaps: [...gaps] },
      });
    };
    ctx.bus.subscribe(
      { name: config.topic },
      (r) => {
        values.push(r.value);
        if (r.key !== undefined) keys.push(r.key);
        send();
      },
      {
        ...(config.group === undefined ? {} : { group: config.group }),
        onGap: (g) => {
          gaps.push(g);
          send();
        },
      },
    );
    if (config.hold) {
      const release = ctx.keepAwake();
      ctx.bus.subscribe(notes, () => release());
    }
    send();
  },
};
