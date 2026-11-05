// Test isolate for host calls (plan m1-kernel, task 9). On "grow" it resizes
// the box and measures it in the same task, before the patch has been
// applied; the rect must still show the new size.
type Rect = { x: number; y: number; width: number; height: number };
type Ctx = {
  root?: Element;
  host: {
    measure(node: unknown): Promise<Rect>;
    focus(node: unknown): Promise<void>;
  };
};

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    const box = document.createElement('div');
    box.setAttribute('class', 'box');
    box.setAttribute('style', 'width: 100px; height: 20px; margin-left: 7px;');
    const grow = document.createElement('button');
    grow.setAttribute('class', 'grow');
    grow.textContent = 'grow';
    const field = document.createElement('input');
    const out = document.createElement('p');
    out.setAttribute('class', 'out');
    const err = document.createElement('p');
    err.setAttribute('class', 'err');
    grow.addEventListener('click', () => {
      box.setAttribute('style', 'width: 300px; height: 20px; margin-left: 7px;');
      ctx.host.measure(box).then(
        (r) => {
          out.textContent = `${r.x},${r.width}`;
        },
        (e: unknown) => {
          out.textContent = String(e);
        },
      );
      ctx.host.measure(document.createElement('span')).catch((e: unknown) => {
        err.textContent = e instanceof Error ? `${e.name} ${String(Reflect.get(e, 'code'))}` : '?';
      });
      void ctx.host.focus(field);
    });
    root.append(box, grow, field, out, err);
  },
};
