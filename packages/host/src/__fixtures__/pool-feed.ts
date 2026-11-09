// A headless pool member for M2d: reads `count` from its committed offset and
// reports what it has seen. With `config.spin`, it loops forever after 300 ms.
import { count, report } from './contracts';

type Rec = { value: unknown };
type Ctx = {
  id: string;
  config: unknown;
  bus: {
    publish(topic: unknown, rec: { value: unknown }): Promise<void>;
    subscribe(topic: unknown, fn: (r: Rec) => void, opts?: { from?: string }): () => void;
  };
};

const spins = (config: unknown): boolean =>
  typeof config === 'object' && config !== null && 'spin' in config && config.spin === true;

export default {
  start(ctx: Ctx): void {
    const seen: unknown[] = [];
    ctx.bus.subscribe(
      count,
      (r) => {
        seen.push(r.value);
        void ctx.bus.publish(report, {
          value: { id: ctx.id, resets: {}, ports: 0, seen: seen.length, values: [...seen] },
        });
      },
      { from: 'committed' },
    );
    if (spins(ctx.config)) {
      setTimeout(() => {
        for (;;) {
          // Never yields.
        }
      }, 300);
    }
  },
};
