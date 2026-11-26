import { defineIsolate } from '@isoloop/runtime';
import { tasks, totals } from './contracts';

// A value over several lines keeps its own indentation once `value:` is gone.
export default defineIsolate((ctx) => {
  const send = (id: string, n: number) => {
    void ctx.bus.publish(tasks, {
      key: id,
      value: {
        id,
        // how many, not how long
        count: n,
        note: `first
    second`,
        parts: {
          first: 1,
        },
      },
    });
    void ctx.bus.publish(totals, {
      value: {
        sum: n,
      },
    });
  };
  return send;
});
