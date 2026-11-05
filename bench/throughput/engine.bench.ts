import { TsEngine } from '@isoloop/bus';
import type { Retention } from '@isoloop/protocol';
import { expect, it } from 'vitest';

/**
 * Engine micro-bench (M2 task 3): append then read 1M records, for each
 * retention. No broker, no ports. The end-to-end throughput bench with
 * subscribers comes with M2 task 13.
 */
const N = 1_000_000;
const PAGE = 64;
const value = { sku: 'sku-0000', qty: 1, note: 'x'.repeat(160) }; // ~200 bytes

const cases: [string, Retention][] = [
  ['last-n 1M', { kind: 'last-n', n: N }],
  ['last-n 10k', { kind: 'last-n', n: 10_000 }],
  ['compacted, 1k keys', { kind: 'compacted' }],
  ['time 1h', { kind: 'time', ms: 3_600_000 }],
];

const rate = (n: number, ms: number): string =>
  `${Math.round((n / ms) * 1000).toLocaleString('en')}/s`;

it.each(cases)('%s', (name, retention) => {
  const engine = new TsEngine();
  engine.createTopic({ name: 't', retention, requestable: false });
  const keyed = retention.kind === 'compacted';
  const ts = Date.now();

  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    engine.append(
      't',
      keyed ? { key: `k${i % 1000}`, value, ts, producer: 'p' } : { value, ts, producer: 'p' },
    );
  }
  const t1 = performance.now();
  let read = 0;
  for (let o = engine.tail('t'); ;) {
    const page = engine.read('t', o, PAGE);
    if (page.length === 0) break;
    read += page.length;
    o = (page.at(-1)?.offset ?? o) + 1;
  }
  const t2 = performance.now();

  expect(engine.head('t')).toBe(N);
  process.stdout.write(
    `${name.padEnd(20)} append ${rate(N, t1 - t0).padStart(12)}  read ${rate(read, t2 - t1).padStart(12)} (${read.toLocaleString('en')} records, pages of ${PAGE})\n`,
  );
});
