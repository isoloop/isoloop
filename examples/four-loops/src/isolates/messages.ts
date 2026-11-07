import { defineIsolate } from '@isoloop/runtime';
import { count, note, primes, store } from '../topics';
import { el } from './dom';

// D · Messages. Its log is built only from the bus, read from `earliest`, so
// a restarted D replays the log and shows the same history (RFC 0001's M2
// done-criterion). "Crash" throws, to watch exactly that.
export default defineIsolate<HTMLElement>({
  start(ctx) {
    const { root } = ctx;
    if (!root) return;
    const lines: string[] = [];
    let replayed = 0;
    const log = el('ul', { class: 'log' }, el('li', {}, 'Waiting for bus messages…'));
    const stats = el('p', { class: 'muted mono replayed' }, '0 records read');
    const snapshot = el('p', { class: 'muted mono store' }, 'store: -');
    const push = (line: string) => {
      replayed++;
      stats.textContent = `${replayed} records read`;
      lines.unshift(line);
      lines.length = Math.min(lines.length, 5);
      log.replaceChildren(...lines.map((l) => el('li', {}, l)));
    };
    ctx.bus.subscribe(count, (r) => push(`${r.producer} count = ${r.value}`), { from: 'earliest' });
    ctx.bus.subscribe(note, (r) => push(`${r.producer} note: ${r.value}`), { from: 'earliest' });
    ctx.bus.subscribe(
      primes,
      (r) => push(`${r.producer} primes = ${r.value.count} (${r.value.ms} ms)`),
      {
        from: 'earliest',
      },
    );
    ctx.bus.subscribe(
      store,
      (r) => {
        snapshot.textContent = `store: count ${r.value.count}, notes ${r.value.notes}`;
      },
      { from: 'earliest' },
    );

    const input = el('input', { placeholder: 'Send a note to A' });
    const sendButton = el('button', { class: 'primary' }, 'Send');
    const crash = el('button', {}, 'Crash');
    crash.addEventListener('click', () => {
      throw new Error('Isolate D threw on purpose');
    });
    const send = async () => {
      const draft = input.value;
      if (!draft.trim()) return;
      try {
        await ctx.bus.publish(note, { value: draft });
      } catch (e) {
        push(`note rejected: ${e instanceof Error ? e.message : String(e)}`);
      }
      // The host owns a focused input's value (design §4.6): `force` clears it
      // while the user is still in it, caret and focus kept.
      ctx.setValue(input, '', { force: true });
    };
    sendButton.addEventListener('click', () => void send());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void send();
    });
    root.append(
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'row' }, input, sendButton, crash),
        log,
        stats,
        snapshot,
      ),
    );
  },
});
