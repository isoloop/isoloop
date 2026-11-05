import { defineIsolate } from '@isoloop/runtime';
import { count, note as noteTopic } from '../topics';
import { el } from './dom';

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
      void ctx.bus.publish(count, { value: n });
    });
    ctx.bus.subscribe(noteTopic, (r) => {
      note.textContent = `${r.producer} says: ${r.value}`;
    });
    root.append(
      el(
        'div',
        { class: 'stack' },
        big,
        inc,
        el('p', { class: 'muted' }, 'Publishes count.v1 on the bus.'),
        note,
      ),
    );
  },
});
