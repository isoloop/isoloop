/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-return, no-await-in-loop, no-shadow, unicorn/no-array-reverse, unicorn/no-array-sort, unicorn/prefer-add-event-listener -- a throwaway probe over untyped trace and page data (plant-one-pool.md) */
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const code = readFileSync(new URL('./bench-worker.js', import.meta.url), 'utf8');
const ROUNDS = Number(process.env.ROUNDS ?? 5),
  RATE = Number(process.env.RATE ?? 5),
  SECONDS = Number(process.env.SECONDS ?? 30);
const VARIANTS = [
  'plain',
  'full',
  'freeze, no accessors',
  'accessors only, no freeze',
  'accessors on Array.prototype only',
  'accessors on Map/Set only',
  'accessors on typed arrays only',
  'accessors on Object/Function only',
];
const browser = await chromium.launch();
const out = Object.fromEntries(VARIANTS.map((v) => [v, []]));
for (let r = 0; r < ROUNDS; r++) {
  const order = r % 2 ? [...VARIANTS].reverse() : VARIANTS;
  for (const variant of order) {
    const page = await browser.newPage();
    const res = await page.evaluate(
      ({ code, variant, RATE, SECONDS }) =>
        new Promise((ok) => {
          const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
          w.onmessage = (e) => {
            ok(e.data);
            w.terminate();
          };
          w.postMessage({ variant, rate: RATE, seconds: SECONDS });
        }),
      { code, variant, RATE, SECONDS },
    );
    out[variant].push(res.ms);
    await page.close();
  }
}
await browser.close();
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const base = med(out.plain);
for (const v of VARIANTS) {
  const m = med(out[v]);
  console.log(
    `${RATE} kHz | ${v.padEnd(36)} | ${(m / SECONDS).toFixed(1)} ms per simulated s | ×${(m / base).toFixed(2)} | ${Math.min(...out[v]).toFixed(0)}–${Math.max(...out[v]).toFixed(0)} ms`,
  );
}
