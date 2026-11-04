import type { LegacyIsolate } from '../index';

type State = { n: number; got: string | null };

/** Test isolate: a counter that can publish, receive a note, and crash. */
export default function main(iso: LegacyIsolate<State>): void {
  iso.setState({ n: 0, got: null });
  iso.on('inc', () => {
    iso.setState((s) => ({ n: s.n + 1 }));
  });
  iso.on('pub', () => {
    iso.bus.publish('count', iso.state.n);
  });
  iso.on('crash', () => {
    throw new Error('fixture crash');
  });
  iso.bus.subscribe('note', (value, from) => {
    iso.setState({ got: `${from}: ${JSON.stringify(value)}` });
  });
  iso.view((s) => iso.h('div', { class: 'n' }, s.n, s.got));
}
