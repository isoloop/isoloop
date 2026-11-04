import type { LegacyIsolate } from '@isoloop/runtime';

type State = { ticks: number };

// B · Ticker
export default function main(iso: LegacyIsolate<State>): void {
  const { h } = iso;
  const start = Date.now();
  iso.setState({ ticks: 0 });
  setInterval(() => {
    iso.setState((s) => ({ ticks: s.ticks + 1 }));
  }, 50);
  iso.view((s) =>
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'big mono' }, `${((Date.now() - start) / 1000).toFixed(1)}s`),
      h('p', { class: 'muted' }, `${s.ticks} ticks on this loop, 20 per second`),
      h(
        'p',
        { class: 'muted' },
        'Keeps running while C is blocked. Freezes on screen (but keeps counting) while the main thread is blocked.',
      ),
    ),
  );
}
