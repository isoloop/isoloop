import { defineIsolate } from '@isoloop/runtime';
import { el } from './dom';

// B · Ticker
export default defineIsolate<HTMLElement>({
  start(ctx) {
    const { root } = ctx;
    if (!root) return;
    const start = Date.now();
    let ticks = 0;
    const big = el('div', { class: 'big mono' }, '0.0s');
    const count = el('p', { class: 'muted' }, '0 ticks on this loop, 20 per second');
    setInterval(() => {
      ticks++;
      big.textContent = `${((Date.now() - start) / 1000).toFixed(1)}s`;
      count.textContent = `${ticks} ticks on this loop, 20 per second`;
    }, 50);
    root.append(
      el(
        'div',
        { class: 'stack' },
        big,
        count,
        el(
          'p',
          { class: 'muted' },
          'Keeps running while C is blocked. Freezes on screen (but keeps counting) while the main thread is blocked.',
        ),
      ),
    );
  },
});
