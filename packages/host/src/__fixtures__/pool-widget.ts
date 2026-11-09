// A visual pool member for M2d (ADR 0015): draws the latest `count` into its
// own root. With `config.spin`, it draws, then loops forever after 300 ms.
// Typed structurally; the worker's `document` is the isoloop-dom subset.
import { count } from './contracts';

type Rec = { value: unknown };
type Ctx = {
  id: string;
  config: unknown;
  root?: Element;
  bus: { subscribe(topic: unknown, fn: (r: Rec) => void, opts?: { from?: string }): () => void };
};

const spins = (config: unknown): boolean =>
  typeof config === 'object' && config !== null && 'spin' in config && config.spin === true;

export default {
  start(ctx: Ctx): void {
    const root = ctx.root;
    if (!root) throw new Error('no root');
    const v = document.createElement('span');
    v.setAttribute('class', 'v');
    v.setAttribute('data-id', ctx.id);
    v.textContent = '-';
    const button = document.createElement('button');
    let clicks = 0;
    button.textContent = '0';
    button.addEventListener('click', () => {
      clicks++;
      button.textContent = String(clicks);
    });
    root.append(v, button);
    ctx.bus.subscribe(
      count,
      (r) => {
        v.textContent = String(r.value);
      },
      { from: 'earliest' },
    );
    if (spins(ctx.config)) {
      setTimeout(() => {
        for (;;) {
          // Never yields.
        }
      }, 300);
    }
  },
};
