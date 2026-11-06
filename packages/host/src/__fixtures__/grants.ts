// Headless test isolate on the real runtime and BusClient for I4: it
// subscribes to `count.v1` and `notes.v1`, publishes to both, and reports
// what it received and how each publish ended. Its manifest grants decide
// which of those work. Typed structurally: host may not import @isoloop/runtime.
import { count, notes, report } from './contracts';

type Rec = { value: unknown };
type Ctx = {
  id: string;
  bus: {
    publish(topic: unknown, rec: { value: unknown }): Promise<void>;
    subscribe(topic: unknown, fn: (r: Rec) => void, opts?: { from?: string }): () => void;
  };
};

const code = (err: unknown): string =>
  typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : String(err);

export default {
  start(ctx: Ctx): void {
    const seen: string[] = [];
    const published: Record<string, string> = {};
    const send = (): void => {
      void ctx.bus.publish(report, {
        value: { id: ctx.id, seen: [...seen], published: { ...published } },
      });
    };
    ctx.bus.subscribe(count, (r) => {
      seen.push(`count.v1:${String(r.value)}`);
      send();
    });
    ctx.bus.subscribe(notes, (r) => {
      seen.push(`notes.v1:${String(r.value)}`);
      send();
    });
    const attempt = (topic: { name: string }, value: unknown): Promise<void> =>
      ctx.bus.publish(topic, { value }).then(
        () => {
          published[topic.name] = 'ok';
        },
        (err: unknown) => {
          published[topic.name] = code(err);
        },
      );
    void Promise.all([attempt(count, 1), attempt(notes, `from ${ctx.id}`)]).then(send);
  },
};
