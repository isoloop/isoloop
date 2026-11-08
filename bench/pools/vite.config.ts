// The M2c benchmark gate page (bench/pools/README.md): 20 small headless
// isolate modules, hosted either one per worker or all in one worker, by the
// same prototype worker script. Cross-origin isolated, so Chromium can
// report per-worker memory.
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

/** How many distinct member modules the page can load. */
export const MEMBERS = 20;

/**
 * `virtual:members`: an array of import thunks, one per member module, and
 * `virtual:member/<n>`: a small headless isolate with its own code (a
 * distinct coefficient table), so a pool loads 20 different modules, as an
 * app with 20 different feeds or engines would.
 */
function members(): Plugin {
  return {
    name: 'pool-gate-members',
    resolveId(id) {
      if (id === 'virtual:members' || id.startsWith('virtual:member/')) return `\0${id}`;
      return null;
    },
    load(id) {
      if (id === '\0virtual:members') {
        const thunks = Array.from(
          { length: MEMBERS },
          (_, i) => `() => import('virtual:member/${i}')`,
        );
        return `export default [${thunks.join(', ')}];`;
      }
      const m = /^\0virtual:member\/(\d+)$/.exec(id);
      if (!m) return null;
      const n = Number(m[1]);
      const table = Array.from({ length: 128 }, (_, i) => ((i * (n + 3)) % 97) / 97);
      return `
import { defineIsolate } from '@isoloop/runtime';
const TABLE = ${JSON.stringify(table)};
export default defineIsolate({
  start(ctx) {
    // A small headless isolate: a rolling window and a weighted mean every 100 ms.
    const window = new Float64Array(TABLE.length);
    let i = 0;
    let last = 0;
    const tick = setInterval(() => {
      window[i++ % window.length] = Math.random();
      let s = 0;
      for (let k = 0; k < window.length; k++) s += window[k] * TABLE[k];
      last = s;
    }, 100);
    ctx.onShutdown(() => clearInterval(tick));
    return { member: ${n}, read: () => last };
  },
});
`;
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./app', import.meta.url)),
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  plugins: [members()],
  worker: { format: 'es', plugins: () => [members()] },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: { target: 'es2022' },
  base: './',
});
