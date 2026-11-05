// Test isolate: renders, gets going, then loops forever, so its heartbeat stops for good.
type Ctx = { root?: Element };

export default {
  start(ctx: Ctx): void {
    if (ctx.root) {
      const span = document.createElement('span');
      span.textContent = 'spinning soon';
      ctx.root.append(span);
    }
    setTimeout(() => {
      for (;;) {
        // Never yields.
      }
    }, 300);
  },
};
