import { defineIsolate } from '@isoloop/runtime';
import { count, note, primes } from '../topics';
import { el } from './dom';

// D · Messages
export default defineIsolate<HTMLElement>({
  start(ctx) {
    const { root } = ctx;
    if (!root) return;
    const lines: string[] = [];
    const log = el('ul', { class: 'log' }, el('li', {}, 'Waiting for bus messages…'));
    const push = (line: string) => {
      lines.unshift(line);
      lines.length = Math.min(lines.length, 5);
      log.replaceChildren(...lines.map((l) => el('li', {}, l)));
    };
    ctx.bus.subscribe(count, (r) => {
      push(`${r.producer} count = ${r.value}`);
    });
    ctx.bus.subscribe(primes, (r) => {
      push(`${r.producer} primes = ${r.value.count} (${r.value.ms} ms)`);
    });

    const input = el('input', { placeholder: 'Send a note to A' });
    const sendButton = el('button', { class: 'primary' }, 'Send');
    const send = async () => {
      const draft = input.value;
      if (!draft.trim()) return;
      try {
        await ctx.bus.publish(note, { value: draft });
        push(`me → note: ${draft}`);
      } catch (e) {
        push(`note rejected: ${e instanceof Error ? e.message : String(e)}`);
      }
      // The host owns a focused input's value (design §4.6), so focus moves off
      // the input before it's cleared. Until an isolate can force a value,
      // that's the way to reset one.
      await ctx.host.focus(sendButton);
      input.value = '';
    };
    sendButton.addEventListener('click', () => void send());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void send();
    });
    root.append(el('div', { class: 'stack' }, el('div', { class: 'row' }, input, sendButton), log));
  },
});
