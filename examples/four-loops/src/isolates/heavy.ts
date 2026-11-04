import type { LegacyIsolate } from '@isoloop/runtime';

type State = { result: string; lastCount: number | null };

// C · Heavy work
export default function main(iso: LegacyIsolate<State>): void {
  const { h } = iso;
  iso.setState({ result: 'nothing yet', lastCount: null });
  iso.on('block', () => {
    const t = performance.now();
    while (performance.now() - t < 3000) {
      // Blocks this isolate's event loop, and only this one.
    }
    iso.setState({ result: 'blocked for 3000 ms' });
  });
  iso.on('primes', () => {
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
    iso.setState({ result: `${count.toLocaleString()} primes below 30M in ${ms} ms` });
    iso.bus.publish('primes', { count, ms });
  });
  iso.on('crash', () => {
    throw new Error('Federate C threw on purpose');
  });
  iso.bus.subscribe('count', (n) => {
    iso.setState({ lastCount: typeof n === 'number' ? n : null });
  });
  iso.view((s) =>
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'primary', onclick: 'block' }, 'Block this loop 3s'),
        h('button', { onclick: 'primes' }, 'Count primes'),
        h('button', { onclick: 'crash' }, 'Crash'),
      ),
      h('p', { class: 'mono' }, s.result),
      h(
        'p',
        { class: 'muted' },
        `Last count from A: ${s.lastCount ?? '-'}. Messages sent while blocked queue up and arrive after.`,
      ),
    ),
  );
}
