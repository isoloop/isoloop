/// <reference lib="webworker" />
/*
 * The gate's feed: stands in for the bus, sending each widget its records
 * over its own MessagePort at the plant dashboard's rates (records.ts). Same
 * feed in both modes; only where the widgets run differs.
 */
import { kindOf, now, SCALARS_MS, VIB_CHUNK_MS, VIB_SAMPLES } from './records.ts';

declare const self: DedicatedWorkerGlobalScope;

const r = (): number => Math.random();

self.addEventListener('message', (e: MessageEvent<{ ports: MessagePort[] }>) => {
  const { ports } = e.data;
  let phase = 0;
  setInterval(() => {
    phase += 1;
    const values = new Float32Array(VIB_SAMPLES);
    for (let i = 0; i < values.length; i++) {
      values[i] = Math.sin((phase * VIB_SAMPLES + i) / 7) + (Math.random() - 0.5) * 0.3;
    }
    ports.forEach((p, m) => {
      if (kindOf(m) === 'vib') p.postMessage({ t: now(), values: values.slice() });
    });
  }, VIB_CHUNK_MS);
  setInterval(() => {
    ports.forEach((p, m) => {
      if (kindOf(m) !== 'scalars') return;
      p.postMessage({
        t: now(),
        bearingC: [70 + r() * 3, 68 + r() * 3],
        exhaustC: 410 + r() * 6,
        barG: 18 + r(),
        rpm: 3000 + r() * 20,
        kw: 4800 + r() * 50,
      });
    });
  }, SCALARS_MS);
});
