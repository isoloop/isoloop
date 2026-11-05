// Test isolate: an onShutdown handler that changes the DOM after a delay.
import { defineIsolate, type IsolateDefinition } from '../vanilla';

const isolate: IsolateDefinition = defineIsolate({
  start(ctx) {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    ctx.onShutdown(async (reason) => {
      await new Promise((r) => setTimeout(r, 50));
      root.textContent = `bye: ${reason}`;
    });
    root.textContent = 'up';
  },
});

export default isolate;
