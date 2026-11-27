// A headless isolate for the watchers suite (M8 Watchers W1, task 6). It
// watches every topic named in its config with `ctx.bus.watch` and reports
// each view on `watch-view.v1`, with an id for this start, so a test can tell
// a woken instance's views from the first one's.

const instance = Math.random().toString(36).slice(2);

export default {
  /** @param {{ config: unknown; bus: { watch(t: { name: string }, onView: (view: ReadonlyMap<string | null, unknown>) => void): () => void; publish(t: { name: string }, value: unknown): Promise<void> } }} ctx */
  start(ctx) {
    /** @type {unknown} */
    const topics =
      typeof ctx.config === 'object' && ctx.config !== null
        ? Reflect.get(ctx.config, 'topics')
        : undefined;
    if (!Array.isArray(topics)) throw new Error('config.topics: the topics to watch');
    /** @type {unknown[]} */
    const names = topics;
    for (const name of names) {
      ctx.bus.watch({ name: String(name) }, (view) => {
        void ctx.bus.publish({ name: 'watch-view.v1' }, { instance, topic: name, view: [...view] });
      });
    }
  },
};
