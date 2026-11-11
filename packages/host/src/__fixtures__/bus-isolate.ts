// Headless test isolate on the real runtime and BusClient. Typed
// structurally: host may not import @isoloop/runtime.
import { count, report } from './contracts';

type Rec = { offset: number; value: unknown };
type Ctx = {
  id: string;
  config: unknown;
  bus: {
    publish(topic: unknown, rec: { value: unknown }): Promise<void>;
    subscribe(topic: unknown, fn: (r: Rec) => void, opts?: { from?: string }): () => void;
  };
};

const mode = (config: unknown): string =>
  typeof config === 'object' && config !== null && 'mode' in config ? String(config.mode) : '';

export default {
  start(ctx: Ctx): void {
    const seen: unknown[] = [];
    const send = (extra: Record<string, unknown> = {}): void => {
      void ctx.bus.publish(report, {
        value: { id: ctx.id, resets: {}, ports: 0, seen: seen.length, values: [...seen], ...extra },
      });
    };
    if (mode(ctx.config) === 'flaky') {
      // Throws on 2: that record and the ones after it are never committed.
      ctx.bus.subscribe(
        count,
        (r) => {
          seen.push(r.value);
          send();
          if (r.value === 2) throw new Error('flaky handler');
        },
        { from: 'committed' },
      );
      send();
      return;
    }
    if (mode(ctx.config) === 'burst') {
      // In one task: six good records and three the schema rejects, so a
      // batch carries them all (ADR 0016, decision 3). Each is still checked,
      // counted and answered on its own.
      let failed = 0;
      const all: Promise<void>[] = [];
      for (let i = 0; i < 9; i++) {
        const value = i % 3 === 2 ? 'bad' : i;
        all.push(
          ctx.bus.publish(count, { value }).catch(() => {
            failed++;
          }),
        );
      }
      void Promise.all(all).then(() => {
        send({ failed });
      });
      return;
    }
    if (mode(ctx.config) === 'publisher') {
      // A steady stream 0, 1, 2, …; every promise must resolve, none reject.
      let n = 0;
      let failed = 0;
      setInterval(() => {
        ctx.bus.publish(count, { value: n++ }).catch(() => {
          failed++;
          send({ failed });
        });
      }, 5);
    }
  },
};
