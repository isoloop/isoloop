import { defineIsolate } from '@isoloop/runtime';
import { count } from './contracts';

// A 0.1 isolate that 0.2 leaves as it is.
export default defineIsolate((ctx) => {
  void ctx.bus.publish(count, { value: 1 });
});
