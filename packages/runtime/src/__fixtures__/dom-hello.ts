// Test isolate on isoloop-dom@1: renders into ctx.root, and checks that the
// DOM subset is installed as the worker's document.
type El = {
  textContent: string;
  addEventListener(type: string, fn: () => void): void;
};
type Ctx = { id: string; root?: { append(...n: El[]): void } };
// The runtime compiles without DOM types; this is the isoloop-dom subset's document.
declare const document: { createElement(tag: string): El };

export default {
  start(ctx: Ctx): void {
    if (!ctx.root) throw new Error('no root');
    const p = document.createElement('p');
    p.textContent = `hello ${ctx.id}`;
    p.addEventListener('click', () => {
      p.textContent = 'clicked';
    });
    ctx.root.append(p);
  },
};
