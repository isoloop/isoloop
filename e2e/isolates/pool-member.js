// A headless member for the pools suite (M2c task 8). It reads `feed.v1` from
// its committed offset and reports `{ id, instance, seen }` on `pooled.v1` at
// start and after every record, so the test can tell which members restarted
// (a new instance) and what each replayed. `config.fault` makes it misbehave:
// `hang` loops forever, `kill` throws from a timer (the worker's `error`
// event), `throw` throws in start().

export default {
  /** @param {{ id: string; config: unknown; bus: { publish(t: { name: string }, r: { value: unknown }): Promise<void>; subscribe(t: { name: string }, fn: (r: { value: unknown }) => void, o?: { from?: string }): () => void } }} ctx */
  start(ctx) {
    /** @type {unknown} */
    const fault =
      typeof ctx.config === 'object' && ctx.config !== null
        ? Reflect.get(ctx.config, 'fault')
        : undefined;
    if (fault === 'throw') throw new Error(`${ctx.id} throws in start`);
    const instance = Math.random().toString(36).slice(2);
    /** @type {unknown[]} */
    const seen = [];
    const report = () =>
      void ctx.bus
        .publish({ name: 'pooled.v1' }, { value: { id: ctx.id, instance, seen: [...seen] } })
        .catch(() => {});
    ctx.bus.subscribe(
      { name: 'feed.v1' },
      (r) => {
        seen.push(r.value);
        report();
      },
      { from: 'committed' },
    );
    report();
    if (fault === 'hang')
      setTimeout(() => {
        for (;;) {
          // Never returns.
        }
      }, 600);
    if (fault === 'kill')
      setTimeout(() => {
        throw new Error(`${ctx.id} throws from a timer`);
      }, 600);
  },
};
