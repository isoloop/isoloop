import { Worker } from 'node:worker_threads';
import { it } from 'vitest';
import { WORKLOADS } from './workloads';

/**
 * The pool freeze's cost to ordinary code (ADR 0001, "Override taming without
 * the protected properties"; docs/investigations/plant-one-pool.md). Each
 * variant runs in a fresh worker thread, so each gets its own realm: a plain
 * worker, the freeze as built in M2c (every prototype property an accessor),
 * and the freeze now (the properties V8 protects left as frozen data).
 * Reported, not asserted: the ratios depend on the machine.
 */
const N = 2_000_000;
const ROUNDS = 5;
const VARIANTS = ['plain', 'previous', 'now'] as const;

const runIn = (variant: string): Promise<Record<string, number>> =>
  new Promise((resolve, reject) => {
    const w = new Worker(new URL('./freeze-worker.ts', import.meta.url), {
      workerData: { variant, n: N },
    });
    w.once('message', (m: Record<string, number>) => {
      resolve(m);
      void w.terminate();
    });
    w.once('error', reject);
  });

const median = (xs: number[]): number =>
  // oxlint-disable-next-line unicorn/no-array-sort -- a fresh typed array; the bench lib is ES2022
  Float64Array.from(xs).sort()[Math.floor(xs.length / 2)] ?? 0;

it('pool freeze: cost per workload, against a plain worker', async () => {
  const got: Record<string, Record<string, number[]>> = {};
  for (let r = 0; r < ROUNDS; r++) {
    const order = r % 2 ? VARIANTS.map((_, i, a) => a[a.length - 1 - i] ?? 'plain') : VARIANTS;
    for (const v of order) {
      // oxlint-disable-next-line no-await-in-loop -- one worker at a time, for clean timings
      const res = await runIn(v);
      for (const [name, ms] of Object.entries(res)) ((got[name] ??= {})[v] ??= []).push(ms);
    }
  }
  const rows = Object.keys(WORKLOADS).map((name) => {
    const m = (v: string): number => median(got[name]?.[v] ?? []);
    const plain = m('plain');
    return {
      workload: name,
      'plain ms': plain.toFixed(1),
      'previous ×': (m('previous') / plain).toFixed(2),
      'now ×': (m('now') / plain).toFixed(2),
    };
  });
  console.table(rows);
}, 300_000);
