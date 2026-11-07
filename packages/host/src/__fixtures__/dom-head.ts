// Test isolate for document.head (M3a task 3): what React 19 does with a
// <title>, twice, plus something in the surface to wait for.
type Ctx = { root?: Element };

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    document.head.insertBefore(document.createElement('title'), null);
    const p = document.createElement('p');
    p.textContent = 'body';
    root.append(p);
    setTimeout(() => {
      document.head.insertBefore(document.createElement('title'), null);
      document.head.insertBefore(document.createElement('meta'), null);
      p.textContent = 'later';
    }, 20);
  },
};
