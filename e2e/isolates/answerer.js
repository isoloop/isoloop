// Answers `answer.v1` requests for the dev MCP suite (M4a task 8), saying
// which transport the call came through (`req.via`, ADR 0018, decision 4).

export default {
  /** @param {{ bus: { subscribe(t: { name: string }, fn: (r: { value: { q: string }; req?: { via?: string } }) => void, o?: { from?: string }): () => void; reply(r: unknown, v: unknown): Promise<void> } }} ctx */
  start(ctx) {
    ctx.bus.subscribe(
      { name: 'answer.v1' },
      (r) => {
        if (r.req === undefined) return;
        void ctx.bus.reply(r, { a: `echo:${r.value.q}`, via: r.req.via ?? null });
      },
      { from: 'committed' },
    );
  },
};
