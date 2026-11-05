// Test isolate without a surface: no root, and no DOM subset installed.
type Ctx = { root?: unknown };

export default {
  start(ctx: Ctx): void {
    if (ctx.root !== undefined || 'document' in globalThis) throw new Error('has a DOM');
  },
};
