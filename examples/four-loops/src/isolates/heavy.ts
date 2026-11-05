import { defineIsolate } from '@isoloop/runtime';
import { el } from './dom';

// C · Heavy work
export default defineIsolate<HTMLElement>({
  start(ctx) {
    const { root } = ctx;
    if (!root) return;
    const result = el('p', { class: 'mono' }, 'nothing yet');
    const last = el('p', { class: 'muted' });
    const showLast = (n: number | null) => {
      last.textContent = `Last count from A: ${n ?? '-'}. Messages sent while blocked queue up and arrive after.`;
    };
    showLast(null);

    const block = el('button', { class: 'primary' }, 'Block this loop 3s');
    block.addEventListener('click', () => {
      const t = performance.now();
      while (performance.now() - t < 3000) {
        // Blocks this isolate's event loop, and only this one.
      }
      result.textContent = 'blocked for 3000 ms';
    });

    const primes = el('button', {}, 'Count primes');
    primes.addEventListener('click', () => {
      const t = performance.now();
      const N = 30_000_000;
      const sieve = new Uint8Array(N + 1);
      let count = 0;
      for (let i = 2; i <= N; i++) {
        if (!sieve[i]) {
          count++;
          for (let j = i * i; j <= N; j += i) sieve[j] = 1;
        }
      }
      const ms = Math.round(performance.now() - t);
      result.textContent = `${count.toLocaleString()} primes below 30M in ${ms} ms`;
      ctx.bus.publish('primes', { count, ms });
    });

    const hang = el('button', {}, 'Hang');
    hang.addEventListener('click', () => {
      // Never returns: the heartbeat stops, and the supervisor kills the worker.
      for (;;) {
        // Spin.
      }
    });

    const crash = el('button', {}, 'Crash');
    crash.addEventListener('click', () => {
      throw new Error('Isolate C threw on purpose');
    });

    ctx.bus.subscribe('count', (n) => {
      showLast(typeof n === 'number' ? n : null);
    });
    root.append(
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'row' }, block, primes, hang, crash),
        result,
        last,
      ),
    );
  },
});
