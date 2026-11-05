// A headless isolate (ADR 0008) for the isolation suite (plan m1-kernel,
// task 12). It reports what it sees on the M1 bus, then, if config says so,
// hangs so the supervisor has to kill and restart it.

export default {
  /** @param {{ root: unknown; config: unknown; host: { measure(n: unknown): Promise<unknown> }; bus: { publish(t: string, v: unknown): void } }} ctx */
  async start(ctx) {
    let measure = 'resolved';
    try {
      await ctx.host.measure({});
    } catch (e) {
      measure = e && typeof e === 'object' && 'code' in e ? String(e.code) : 'threw';
    }
    ctx.bus.publish('headless', {
      root: ctx.root === undefined ? 'none' : 'some',
      document: typeof document,
      measure,
    });
    /** @type {unknown} */
    const hangAfterMs =
      typeof ctx.config === 'object' && ctx.config !== null
        ? Reflect.get(ctx.config, 'hangAfterMs')
        : undefined;
    if (typeof hangAfterMs === 'number') {
      setTimeout(() => {
        for (;;) {
          // Never returns.
        }
      }, hangAfterMs);
    }
  },
};
