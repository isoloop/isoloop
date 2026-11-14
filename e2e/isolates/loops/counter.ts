import { defineIsolate } from '@isoloop/runtime';
import { count, note as noteTopic } from './topics';
import { el } from './dom';

// A · Counter. count.v1 is persistent, so A picks its value up from the log
// after a reload or a restart: the highest count it finds, since it only goes up.
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
    ctx.bus.subscribe(
      count,
      (r) => {
        if (r.value <= n) return;
        n = r.value;
        big.textContent = String(n);
      },
      { from: 'earliest' },
    );
    ctx.bus.subscribe(noteTopic, (r) => {
      note.textContent = `${r.producer} says: ${r.value}`;
    });
    root.append(
      el(
        'div',
        { class: 'stack' },
        big,
        inc,
        el(
          'p',
          { class: 'muted' },
          'Publishes count.v1 on the bus. It is persistent: reload the page.',
        ),
        note,
      ),
    );
  },
});
