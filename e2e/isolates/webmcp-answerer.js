// Answers the WebMCP suite's requests (M4a task 9), saying which transport the
// call came through (`req.via`, ADR 0018, decision 4). `config.mode`:
// - `echo` (default): replies at once;
// - `block`: spins forever on a request;
// - `crash-live`: crashes on a request appended while it was running, and
//   answers one it gets on catch-up after a restart (appended before it started);
// - `die`: crashes at start, every time.

const born = Date.now();

export default {
  /** @param {{ config: unknown; bus: { subscribe(t: { name: string }, fn: (r: { ts: number; value: { q: string }; req?: { via?: string } }) => unknown, o?: { from?: string }): () => void; reply(r: unknown, v: unknown): Promise<void> } }} ctx */
  start(ctx) {
    const config = typeof ctx.config === 'object' && ctx.config !== null ? ctx.config : {};
    const mode = String(Reflect.get(config, 'mode') ?? 'echo');
    /** @type {unknown} */
    const topics = Reflect.get(config, 'topics');
    if (mode === 'die') throw new Error('died at start');
    for (const name of Array.isArray(topics) ? topics : []) {
      ctx.bus.subscribe(
        { name: String(name) },
        (r) => {
          if (r.req === undefined) return undefined;
          if (mode === 'block') for (;;);
          if (mode === 'crash-live' && r.ts >= born) {
            // From a timer, so the worker dies (a handler's throw is only
            // reported); the pending handler keeps the record uncommitted.
            setTimeout(() => {
              throw new Error('crashed on a live request');
            });
            return new Promise(() => {});
          }
          return ctx.bus.reply(r, { a: `echo:${r.value.q}`, via: r.req.via ?? null });
        },
        { from: 'committed' },
      );
    }
  },
};
