import { parentPort, workerData } from 'node:worker_threads';
import { freezeBuiltins } from '../../packages/runtime/src/freeze.ts';
import { freezeBuiltins as freezePrevious } from './freeze-previous.ts';
import { WORKLOADS } from './workloads.ts';

const data: unknown = workerData;
const variant =
  typeof data === 'object' && data !== null ? String(Reflect.get(data, 'variant')) : 'plain';
const n = typeof data === 'object' && data !== null ? Number(Reflect.get(data, 'n')) : 0;
if (variant === 'previous') freezePrevious();
if (variant === 'now') freezeBuiltins();

const out: Record<string, number> = {};
for (const [name, run] of Object.entries(WORKLOADS)) {
  // oxlint-disable-next-line no-await-in-loop -- one workload at a time, for clean timings
  await run(n); // warm-up
  const t0 = performance.now();
  // oxlint-disable-next-line no-await-in-loop
  await run(n);
  out[name] = performance.now() - t0;
}
parentPort?.postMessage(out);
