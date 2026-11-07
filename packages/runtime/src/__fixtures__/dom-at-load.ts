// Test isolate (M3a task 9): React decides whether it has a DOM when it loads,
// so the subset must be installed before the isolate module is imported.
type Ctx = { root?: { textContent: string | null } };
declare const document: unknown;

const atLoad = typeof document === 'object' && document !== null ? 'document at load' : 'none';

export default {
  start(ctx: Ctx): void {
    if (ctx.root) ctx.root.textContent = atLoad;
  },
};
