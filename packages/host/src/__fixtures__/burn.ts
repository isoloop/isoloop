// Test isolate: every 10 ms, keeps the worker busy for `config.burnMs` (0 by default),
// so its beats carry a busy time of its own (ADR 0017).
type Ctx = { config?: unknown };

export default {
  start(ctx: Ctx): void {
    const c = ctx.config;
    const raw = typeof c === 'object' && c !== null && 'burnMs' in c ? c.burnMs : undefined;
    const burnMs = typeof raw === 'number' ? raw : 0;
    setInterval(() => {
      const end = performance.now() + burnMs;
      while (performance.now() < end) {
        // Busy on purpose.
      }
    }, 10);
  },
};
