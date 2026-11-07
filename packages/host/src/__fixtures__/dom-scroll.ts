// Test isolate for scroll events (M3b task 12): a scrolling box that shows
// its scrollTop, as the last scroll event brought it, in `.out`.
type Ctx = { root?: Element };

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    const box = document.createElement('div');
    box.setAttribute('class', 'box');
    box.setAttribute('style', 'height: 50px; overflow-y: scroll');
    const tall = document.createElement('div');
    tall.setAttribute('style', 'height: 1000px');
    box.append(tall);
    const out = document.createElement('p');
    out.setAttribute('class', 'out');
    box.addEventListener('scroll', () => {
      out.textContent = String(box.scrollTop);
    });
    root.append(box, out);
  },
};
