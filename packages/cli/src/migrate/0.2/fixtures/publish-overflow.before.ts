import { defineIsolate } from '@isoloop/runtime';
import { counts, specs, tasks } from './contracts';

// Records that held the line apart and no longer fit on it, laid out as the
// formatter lays out a call with a value and options.
export default defineIsolate((ctx) => {
  const send = (life: number, lives: number, baseOps: number, ops: number, index: number) => {
    void ctx.bus.publish(counts, {
      key: ctx.id,
      value: { life, lives, ops: baseOps + ops, index: baseIndex + index },
    });
    void ctx.bus.publish(specs, {
      key: ctx.id,
      value: specRecord(ctx.id, Date.now() + 1000 + index + baseIndex),
    });
    void ctx.bus.publish(tasks, {
      key: ctx.id,
      value: {
        load: life,
        rate: lives,
      },
    });
    void ctx.bus.publish(tasks, {
      key: ctx.id,
      value: { load: life },
    });
  };
  return send;
});

const baseIndex = 0;
declare function specRecord(id: string, at: number): unknown;
