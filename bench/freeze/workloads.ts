/**
 * Small, typical loops, one per V8 fast path that a protector guards. Each
 * returns a number so the work can't be optimised away.
 */
const SMALL = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const f32 = new Float32Array(256).map((_, i) => Math.sin(i));
const map = new Map(SMALL.map((k, i) => [k, i]));
const set = new Set(SMALL);
const RE = /acit|ex(?:s|g|n|p|$)|rph|grid|ows/i;

export const WORKLOADS: Record<string, (n: number) => number | Promise<number>> = {
  'for…of over a small array': (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) for (const k of SMALL) x += k.length;
    return x;
  },
  'array destructuring and spread': (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      const [a, b, ...rest] = [i, i + 1, i + 2, i + 3];
      x += a + b + [...rest].length;
    }
    return x;
  },
  'typed array spread': (n) => {
    let x = 0;
    for (let i = 0; i < n / 50; i++) x += [...f32].length;
    return x;
  },
  'Map and Set iteration': (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      for (const [, v] of map) x += v;
      for (const k of set) x += k.length;
    }
    return x;
  },
  'string for…of': (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) for (const c of 'plant-T3') x += c.length;
    return x;
  },
  'array map and slice': (n) => {
    let x = 0;
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = 0; i < n; i++) x += a.map((v) => v + i).slice(2).length;
    return x;
  },
  'regexp test': (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) if (RE.test(i % 2 ? 'grid-row' : 'width')) x++;
    return x;
  },
  'await on resolved promises': async (n) => {
    let x = 0;
    // oxlint-disable-next-line no-await-in-loop -- awaiting in a loop is the workload
    for (let i = 0; i < n / 10; i++) x += await Promise.resolve(i);
    return x;
  },
};
