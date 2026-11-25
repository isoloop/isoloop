/// <reference lib="dom" />
import { it } from 'vitest';
import { WORKLOADS } from './workloads';

/*
 * What the busy-time wrapping (ADR 0017, decision 2) costs an app that
 * doesn't use `@isoloop/balancer` (isoloop#414). The runtime installs it in
 * every worker, balancer or not. Each round runs both variants in fresh
 * module workers, in alternating order: `plain` with native globals, and
 * `wrapped` as the bootstrap leaves them. Reported, not asserted: the figures
 * depend on the machine. `pnpm bench:busy`.
 */
const ROUNDS = 7;
/** Both variants, in turn first, so neither always runs on a warmer machine. */
const ORDERS = [
  ['plain', 'wrapped'],
  ['wrapped', 'plain'],
] as const;

type Result = Record<string, number | null>;

const runIn = (variant: string): Promise<Result> =>
  new Promise((resolve, reject) => {
    const w = new Worker(new URL('./busy-worker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (e: MessageEvent<Result>): void => {
      resolve(e.data);
      w.terminate();
    });
    w.addEventListener('error', (e): void => {
      reject(new Error(e.message));
    });
    w.postMessage({ variant });
  });

const median = (xs: number[]): number => {
  const s = Float64Array.from(xs);
  s.sort();
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

const rate = (n: number, ms: number): string =>
  Number.isFinite(ms) ? Math.round((n / ms) * 1000).toLocaleString('en-US') : '–';

const cell = (r: Record<string, string>, c: string): string => r[c] ?? '';

it('busy-time wrapping: callbacks per second, native against wrapped', async () => {
  const got: Record<string, Record<string, number[]>> = {};
  for (let r = 0; r < ROUNDS; r++) {
    for (const v of ORDERS[r % 2] ?? ORDERS[0]) {
      // oxlint-disable-next-line no-await-in-loop -- one worker at a time, for clean timings
      const res = await runIn(v);
      for (const [name, ms] of Object.entries(res))
        if (ms !== null) ((got[name] ??= {})[v] ??= []).push(ms);
    }
  }
  const rows = Object.entries(WORKLOADS).map(([name, w]) => {
    const plain = median(got[name]?.plain ?? []);
    const wrapped = median(got[name]?.wrapped ?? []);
    return {
      workload: name,
      'native /s': rate(w.n, plain),
      'wrapped /s': rate(w.n, wrapped),
      'extra ns per callback': Number.isFinite(plain)
        ? (((wrapped - plain) / w.n) * 1e6).toFixed(0)
        : '–',
      'wrapped ÷ native time': Number.isFinite(plain) ? (wrapped / plain).toFixed(2) : '–',
    };
  });
  // A text table: `console.table` doesn't reach the terminal from a browser.
  const cols = Object.keys(rows[0] ?? {});
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r, c).length)));
  const line = (vals: string[]): string =>
    vals.map((v, i) => (i === 0 ? v.padEnd(width[i] ?? 0) : v.padStart(width[i] ?? 0))).join('  ');
  console.log(
    [
      `[${navigator.userAgent}]`,
      line(cols),
      ...rows.map((r) => line(cols.map((c) => cell(r, c)))),
    ].join('\n'),
  );
}, 600_000);
