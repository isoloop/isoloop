// Test isolate (M3a task 12): stamped as if built against Isoloop 0.6.
type Ctx = { root?: { textContent: string | null } };

export default {
  requires: '0.6',
  start(ctx: Ctx): void {
    if (ctx.root) ctx.root.textContent = 'built for 0.6';
  },
};
