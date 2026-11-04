import type { LegacyIsolate } from '@isoloop/runtime';
import { text } from './text';

type State = { n: number; note: string | null };

// A · Counter
export default function main(iso: LegacyIsolate<State>): void {
  const { h } = iso;
  iso.setState({ n: 0, note: null });
  iso.on('inc', () => {
    iso.setState((s) => ({ n: s.n + 1 }));
    iso.bus.publish('count', iso.state.n);
  });
  iso.bus.subscribe('note', (note, from) => {
    iso.setState({ note: `${from} says: ${text(note)}` });
  });
  iso.view((s) =>
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'big' }, s.n),
      h('button', { class: 'primary', onclick: 'inc' }, 'Increment'),
      h('p', { class: 'muted' }, 'Publishes "count" on the bus.'),
      s.note && h('p', { class: 'muted mono' }, s.note),
    ),
  );
}
