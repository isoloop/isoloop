import { defineIsolate } from '@isoloop/runtime';
import { el, text } from './dom';

const isPrimes = (p: unknown): p is { count: number; ms: number } =>
  typeof p === 'object' && p !== null && 'count' in p && 'ms' in p;

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
    ctx.legacyBus.subscribe('count', (n, from) => {
      push(`${from} count = ${text(n)}`);
    });
    ctx.legacyBus.subscribe('primes', (p, from) => {
      if (isPrimes(p)) push(`${from} primes = ${p.count} (${p.ms} ms)`);
    });

    const input = el('input', { placeholder: 'Send a note to A' });
    const sendButton = el('button', { class: 'primary' }, 'Send');
    const send = async () => {
      const draft = input.value;
      if (!draft.trim()) return;
      ctx.legacyBus.publish('note', draft);
      push(`me → note: ${draft}`);
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
