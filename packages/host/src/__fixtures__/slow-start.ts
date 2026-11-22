// Test isolate: start() holds the loop for `config.busyMs`, as mounting and a
// first replay do. `ready` has gone out by then (ADR 0001, start-up warm-up).
type Ctx = { config?: unknown };

export default {
  start(ctx: Ctx): void {
    const c = ctx.config;
    const ms = typeof c === 'object' && c !== null && 'busyMs' in c ? c.busyMs : undefined;
    const end = performance.now() + (typeof ms === 'number' ? ms : 0);
    while (performance.now() < end) {
      // Busy on purpose.
    }
  },
};
