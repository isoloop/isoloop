// Test isolate for requestCanvas (M3a task 14): asks twice for its canvas,
// draws a red square on the one it gets, and reports what happened.
type El = {
  textContent: string | null;
  setAttribute(n: string, v: string): void;
  addEventListener(type: string, fn: (e: { width?: number; height?: number }) => void): void;
};
type Ctx = {
  root?: { append(...n: El[]): void };
  host: {
    requestCanvas(node: El, size?: { width?: number; height?: number }): Promise<unknown>;
  };
};
declare const document: { createElement(tag: string): El };

export default {
  async start(ctx: Ctx): Promise<void> {
    if (!ctx.root) throw new Error('no root');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('style', 'width: 40px; height: 30px; display: block');
    const got = document.createElement('p');
    got.setAttribute('class', 'got');
    const again = document.createElement('p');
    again.setAttribute('class', 'again');
    const size = document.createElement('p');
    size.setAttribute('class', 'size');
    canvas.addEventListener('resize', (e) => {
      size.textContent = `${e.width}x${e.height}`;
    });
    ctx.root.append(canvas, got, again, size);
    const off = await ctx.host.requestCanvas(canvas, { width: 40, height: 30 });
    got.textContent = off instanceof OffscreenCanvas ? 'OffscreenCanvas' : String(off);
    if (off instanceof OffscreenCanvas) {
      const g = off.getContext('2d');
      if (g) {
        g.fillStyle = 'rgb(255, 0, 0)';
        g.fillRect(0, 0, 40, 30);
      }
    }
    try {
      await ctx.host.requestCanvas(canvas);
      again.textContent = 'resolved';
    } catch (err) {
      const code: unknown = typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : '';
      again.textContent = `rejected ${String(code)}`;
    }
  },
};
