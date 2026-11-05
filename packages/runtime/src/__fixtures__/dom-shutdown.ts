// Test isolate: an onShutdown handler that changes the DOM after a delay,
// and the M1 bus.
import { defineIsolate, type IsolateDefinition } from '../vanilla';

const isolate: IsolateDefinition = defineIsolate({
  start(ctx) {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    ctx.onShutdown(async (reason) => {
      await new Promise((r) => setTimeout(r, 50));
      root.textContent = `bye: ${reason}`;
    });
    ctx.bus.subscribe('note', (value, from) => {
      root.textContent = `${from}: ${String(value)}`;
    });
    ctx.bus.publish('hello', ctx.id);
  },
});

export default isolate;
