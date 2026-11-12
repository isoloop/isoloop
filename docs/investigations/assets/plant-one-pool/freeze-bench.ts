/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, unicorn/prefer-add-event-listener -- a throwaway probe over untyped trace and page data (plant-one-pool.md) */
// The plant's feed and engines for 8 machines in one worker, driven flat out,
// with variants of the pool's frozen built-ins. Bundle from apps/dashboards/plant
// in isoloop/examples, next to freeze-variant.ts (freeze.ts with `opts` switches:
// `opts.tame(proto)` decides which prototypes get tameOverrides, `opts.freeze`
// whether Object.freeze runs).
import { freezeBuiltins, opts } from './freeze-variant';
import { MACHINES } from './src/core/machines';
import { runMachineEngines } from './src/core/engines';
import { CHUNK_MS, SCALARS_MS, scalarsAt, vibChunk } from './src/core/sensors/signals';
import { Store } from './src/core/store';
import { of } from './src/core/streams';

const only =
  (...ps: object[]) =>
  (p: object) =>
    ps.includes(p);
const VARIANTS: Record<string, () => void> = {
  plain: () => {},
  full: () => freezeBuiltins(),
  'freeze, no accessors': () => {
    opts.tame = () => false;
    freezeBuiltins();
  },
  'accessors only, no freeze': () => {
    opts.freeze = false;
    freezeBuiltins();
  },
  'accessors on Array.prototype only': () => {
    opts.tame = only(Array.prototype);
    opts.freeze = false;
    freezeBuiltins();
  },
  'accessors on Map/Set only': () => {
    opts.tame = only(Map.prototype, Set.prototype);
    opts.freeze = false;
    freezeBuiltins();
  },
  'accessors on typed arrays only': () => {
    opts.tame = only(
      Object.getPrototypeOf(Int8Array).prototype,
      Float32Array.prototype,
      Float64Array.prototype,
    );
    opts.freeze = false;
    freezeBuiltins();
  },
  'accessors on Object/Function only': () => {
    opts.tame = only(Object.prototype, Function.prototype);
    opts.freeze = false;
    freezeBuiltins();
  },
};
self.onmessage = (e: MessageEvent<{ variant: string; rate: number; seconds: number }>) => {
  const { variant, rate, seconds } = e.data;
  VARIANTS[variant]?.();
  const store = new Store();
  for (const m of MACHINES) runMachineEngines(store, m, rate);
  const chunks = (seconds * 1000) / CHUNK_MS;
  const per = SCALARS_MS / CHUNK_MS;
  const run = (from: number, to: number): number => {
    const t0 = performance.now();
    for (let i = from; i < to; i++)
      for (const m of MACHINES) {
        store.publish(of(m, 'vib'), vibChunk(1, m, rate, i));
        if (i % per === 0) store.publish(of(m, 'scalars'), scalarsAt(1, m, i * CHUNK_MS));
      }
    return performance.now() - t0;
  };
  run(0, chunks); // warm-up: JIT, and the 60 s stats windows fill
  postMessage({ variant, ms: run(chunks, 2 * chunks) });
};
