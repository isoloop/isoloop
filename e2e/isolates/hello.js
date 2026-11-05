// A plain ES module isolate served from another origin by isolate-server.ts.

export default {
  /** @param {{ root: Element | undefined }} ctx */
  start(ctx) {
    // Spawned headless by the budget test: nothing to render.
    if (!ctx.root) return;
    const span = document.createElement('span');
    span.setAttribute('class', 'hello');
    span.textContent = `hello from :${new URL(import.meta.url).port}`;
    ctx.root.append(span);
  },
};
