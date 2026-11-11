/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, no-extend-native, typescript/no-unsafe-type-assertion, unicorn/prefer-add-event-listener -- a throwaway probe over untyped trace and page data (plant-one-pool.md) */
// The plant's feed and engines for 8 machines at 5 kHz in one worker, with
// chosen Array.prototype properties turned into accessors as freeze.ts's
// tameOverrides does. Bundle from apps/dashboards/plant in isoloop/examples.
import { MACHINES } from './src/core/machines';
import { runMachineEngines } from './src/core/engines';
import { CHUNK_MS, SCALARS_MS, scalarsAt, vibChunk } from './src/core/sensors/signals';
import { Store } from './src/core/store';
import { of } from './src/core/streams';

function tame(key: PropertyKey): void {
  const proto = Array.prototype as unknown as Record<PropertyKey, unknown>;
  const value = proto[key as string];
  Object.defineProperty(Array.prototype, key, {
    get() {
      return value;
    },
    set(v) {
      Object.defineProperty(this, key, {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
    configurable: false,
  });
}
self.onmessage = (e: MessageEvent<{ keys: string[] }>) => {
  for (const k of e.data.keys) {
    if (k === '@@iterator') tame(Symbol.iterator);
    else if (k === '*')
      for (const x of Reflect.ownKeys(Array.prototype)) {
        if (x !== 'length' && x !== 'constructor') tame(x);
      }
    else tame(k);
  }
  const store = new Store();
  for (const m of MACHINES) runMachineEngines(store, m, 5);
  const chunks = 600;
  const per = SCALARS_MS / CHUNK_MS;
  const run = (a: number, b: number): number => {
    const t = performance.now();
    for (let i = a; i < b; i++)
      for (const m of MACHINES) {
        store.publish(of(m, 'vib'), vibChunk(1, m, 5, i));
        if (i % per === 0) store.publish(of(m, 'scalars'), scalarsAt(1, m, i * CHUNK_MS));
      }
    return performance.now() - t;
  };
  run(0, chunks);
  postMessage(run(chunks, 2 * chunks));
};
