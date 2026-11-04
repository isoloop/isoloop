import type { LegacyIsolate } from '@isoloop/runtime';
import { text } from './text';

type State = { draft: string; log: string[] };

const isPrimes = (p: unknown): p is { count: number; ms: number } =>
  typeof p === 'object' && p !== null && 'count' in p && 'ms' in p;

// D · Messages
export default function main(iso: LegacyIsolate<State>): void {
  const { h } = iso;
  iso.setState({ draft: '', log: [] });
  const push = (line: string): void => {
    iso.setState((s) => ({ log: [line, ...s.log].slice(0, 5) }));
  };
  iso.bus.subscribe('count', (n, from) => {
    push(`${from} count = ${text(n)}`);
  });
  iso.bus.subscribe('primes', (p, from) => {
    if (isPrimes(p)) push(`${from} primes = ${p.count} (${p.ms} ms)`);
  });
  iso.on('type', (v) => {
    iso.setState({ draft: v ?? '' });
  });
  const send = (): void => {
    if (!iso.state.draft.trim()) return;
    iso.bus.publish('note', iso.state.draft);
    push(`me → note: ${iso.state.draft}`);
    iso.setState({ draft: '' });
  };
  iso.on('send', send);
  iso.on('enter', send);
  iso.view((s) =>
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'row' },
        h('input', {
          placeholder: 'Send a note to A',
          value: s.draft,
          oninput: 'type',
          onenter: 'enter',
        }),
        h('button', { class: 'primary', onclick: 'send' }, 'Send'),
      ),
      h(
        'ul',
        { class: 'log' },
        s.log.length
          ? s.log.map((l) => h('li', null, l))
          : h('li', null, 'Waiting for bus messages…'),
      ),
    ),
  );
}
