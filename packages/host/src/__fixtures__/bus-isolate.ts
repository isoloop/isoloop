// Headless test isolate on the real runtime and BusClient. Typed
// structurally: host may not import @isoloop/runtime.
import { count, report, saved } from './contracts';

type Rec = { offset: number; value: unknown };
type Ctx = {
  id: string;
  config: unknown;
  bus: {
    publish(topic: unknown, value: unknown): Promise<void>;
    subscribe(topic: unknown, fn: (r: Rec) => void, opts?: { from?: string }): () => void;
    watch(
      topic: unknown,
      onView: (view: ReadonlyMap<string | null, unknown>, changed: ReadonlySet<unknown>) => void,
    ): () => void;
  };
};

const mode = (config: unknown): string =>
  typeof config === 'object' && config !== null && 'mode' in config ? String(config.mode) : '';

export default {
  start(ctx: Ctx): void {
    const seen: unknown[] = [];
    const send = (extra: Record<string, unknown> = {}): void => {
      void ctx.bus.publish(report, {
        id: ctx.id,
        resets: {},
        ports: 0,
        seen: seen.length,
        values: [...seen],
        ...extra,
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
    if (mode(ctx.config) === 'watcher') {
      // Watches a memory topic and a persistent one, and reports each view.
      const views: Record<string, [string | null, unknown][]> = {};
      let calls = 0;
      for (const [name, topic] of [
        ['count.v1', count],
        ['saved.v1', saved],
      ] as const) {
        ctx.bus.watch(topic, (view) => {
          views[name] = [...view];
          calls++;
          send({ views: { ...views }, calls });
        });
      }
      return;
    }
    if (mode(ctx.config) === 'publisher') {
      // A steady stream 0, 1, 2, …; every promise must resolve, none reject.
      let n = 0;
      let failed = 0;
      setInterval(() => {
        ctx.bus.publish(count, n++).catch(() => {
          failed++;
          send({ failed });
        });
      }, 5);
    }
  },
};
