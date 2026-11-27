import type { BusToIsolate } from '@isoloop/protocol';
import { expect, it } from 'vitest';
import { Broker, type BusPort } from '../../packages/bus/src/broker/broker.ts';
import { contracts, topic, unchecked } from '../../packages/bus/src/contracts/topic.ts';
import { TsEngine } from '../../packages/bus/src/engine/ts-engine.ts';

/**
 * Appends through the broker with and without a watcher on the topic
 * (M8 Watchers W1, task 3). No worker, no ports to another thread: the bus
 * core alone, in one Node process.
 */
const N = 200_000;
const KEYS = 1_000;
/** Records published in one task before the bench yields. */
const BURST = 1_000;
const value = { price: 101.25, size: 3, venue: 'x'.repeat(40) };

const prices = topic('prices.v1', {
  schema: unchecked<typeof value>(),
  retention: { kind: 'last-n', n: 10_000 },
});

type Mode = 'no watcher' | 'watcher, view in flight' | 'watcher, every view seen';

const yieldTask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const rate = (n: number, ms: number): string =>
  `${Math.round((n / ms) * 1000).toLocaleString('en')}/s`;

async function run(mode: Mode): Promise<{ ms: number; views: number }> {
  const broker = new Broker({ contracts: contracts(prices), engine: new TsEngine() });
  let views = 0;
  if (mode !== 'no watcher') {
    let handler: ((msg: unknown) => void) | undefined;
    const port: BusPort = {
      post(msg: BusToIsolate) {
        if (msg.t !== 'view') return;
        views++;
        if (mode === 'watcher, every view seen') {
          const { topic: t, vseq } = msg.p;
          queueMicrotask(() =>
            handler?.({ v: 1, t: 'commits', p: { offsets: [], seen: [{ topic: t, vseq }] } }),
          );
        }
      },
      onMessage(h) {
        handler = h;
      },
      close() {},
    };
    broker.attach('W', { publish: [], subscribe: ['*'] }, port);
    handler?.({ v: 1, t: 'watch', p: { topic: 'prices.v1' } });
    await yieldTask();
  }
  const t0 = performance.now();
  for (let i = 0; i < N; i += BURST) {
    for (let j = i; j < i + BURST; j++) {
      void broker.publish({ kind: 'host' }, 'prices.v1', `k${j % KEYS}`, value);
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- one task per burst
    await yieldTask();
  }
  return { ms: performance.now() - t0, views };
}

it.each<Mode>(['no watcher', 'watcher, view in flight', 'watcher, every view seen'])(
  'appends with %s',
  async (mode) => {
    await run(mode); // warm-up
    const { ms, views } = await run(mode);
    expect(ms).toBeGreaterThan(0);
    process.stdout.write(
      `${mode.padEnd(26)} append ${rate(N, ms).padStart(12)}  views ${views.toLocaleString('en')} (${N.toLocaleString('en')} records, ${KEYS.toLocaleString('en')} keys, bursts of ${BURST.toLocaleString('en')})\n`,
    );
  },
);
