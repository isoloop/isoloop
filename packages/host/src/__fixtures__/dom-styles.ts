// Test isolate for styles (plan m1-kernel, task 10): its own CSS, and a
// rule that reads the host's design token.
type Ctx = { root?: Element; styles(css: string | string[]): void };

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    ctx.styles('p { color: rgb(255, 0, 0); } * { font-weight: 900; }');
    ctx.styles(['.tok { color: var(--brand, rgb(0, 128, 0)); }']);
    const p = document.createElement('p');
    p.textContent = 'isolate p';
    const tok = document.createElement('span');
    tok.setAttribute('class', 'tok');
    tok.textContent = 'token';
    root.append(p, tok);
  },
};
