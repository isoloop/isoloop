import { defineIsolate } from '@isoloop/runtime';
import { el, text } from './dom';

// A · Counter
export default defineIsolate<HTMLElement>({
  start(ctx) {
    const { root } = ctx;
    if (!root) return;
    let n = 0;
    const big = el('div', { class: 'big' }, '0');
    const note = el('p', { class: 'muted mono' });
    const inc = el('button', { class: 'primary' }, 'Increment');
    inc.addEventListener('click', () => {
      n++;
      big.textContent = String(n);
      ctx.bus.publish('count', n);
    });
    ctx.bus.subscribe('note', (value, from) => {
      note.textContent = `${from} says: ${text(value)}`;
    });
    root.append(
      el(
        'div',
        { class: 'stack' },
        big,
        inc,
        el('p', { class: 'muted' }, 'Publishes "count" on the bus.'),
        note,
      ),
    );
  },
});
