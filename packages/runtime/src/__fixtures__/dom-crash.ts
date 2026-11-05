// Test isolate on isoloop-dom@1: a click on its paragraph throws, so the
// error escapes to the worker's global handler.
type El = {
  textContent: string;
  addEventListener(type: string, fn: () => void): void;
};
type Ctx = { root?: { append(...n: El[]): void } };
// The runtime compiles without DOM types; this is the isoloop-dom subset's document.
declare const document: { createElement(tag: string): El };

export default {
  start(ctx: Ctx): void {
    if (!ctx.root) throw new Error('no root');
    const p = document.createElement('p');
    p.textContent = 'crash me';
    p.addEventListener('click', () => {
      throw new Error('fixture crash');
    });
    ctx.root.append(p);
  },
};
