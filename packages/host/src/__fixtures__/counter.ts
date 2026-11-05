// Test isolate on isoloop-dom@1, or headless when spawned without a surface.
// Typed structurally: host may not import @isoloop/runtime.
type Ctx = { root?: Element };

function button(label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    // Headless: no DOM at all, so nothing to render (ADR 0008).
    if (!root) return;
    let n = 0;
    const count = document.createElement('span');
    count.setAttribute('class', 'n');
    const show = (v: number): void => {
      n = v;
      count.textContent = String(v);
    };
    show(0);
    const wrap = document.createElement('div');
    wrap.append(
      count,
      button('inc', () => {
        show(n + 1);
      }),
      button('crash', () => {
        throw new Error('fixture crash');
      }),
      button('block', () => {
        const t = performance.now();
        while (performance.now() - t < 700) {
          // Busy on purpose: the heartbeat stops.
        }
      }),
    );
    root.append(wrap);
  },
};
