/// <reference lib="dom" />
/*
 * Memory per idle isolate (M3a task 17; design §9: ≤ 3 / 5 / 12 MB for
 * vanilla / Preact / React). For each kind, 10 isolates render a small tree
 * and go idle; `performance.measureUserAgentSpecificMemory()` then gives the
 * bytes of each isolate's worker. Reported: the median per isolate, against
 * the target. Report only, in CI's bench job.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const PAGE = 'http://localhost:4797/';
const COUNT = 10;
const TARGET_MB: Record<string, number> = { vanilla: 3, preact: 5, react: 12 };

// `window.bench` is declared by the page (app/main.ts), in this same program.
declare global {
  interface Performance {
    /** Chromium, cross-origin isolated pages only. */
    measureUserAgentSpecificMemory(): Promise<{
      breakdown: { bytes: number; attribution: { url: string; scope: string }[] }[];
    }>;
  }
}

type Measured = { perIsolateMB: number[]; workers: number };

const median = (xs: number[]): number => {
  const s = [...xs];
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

test('memory per idle isolate: vanilla, Preact, React', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  const results: Record<string, { medianMB: number; targetMB: number; samples: number[] }> = {};
  for (const kind of ['vanilla', 'preact', 'react']) {
    // oxlint-disable-next-line no-await-in-loop -- one kind at a time, alone on the page
    const m: Measured = await page.evaluate(
      async ({ kind: k, count }) => {
        const kernel = window.bench.createKernel();
        const src = new URL(window.bench.isolates[k] ?? '', location.href).href;
        for (let i = 0; i < count; i++) {
          const surface = document.createElement('section');
          document.getElementById('root')?.append(surface);
          kernel.spawn({ id: `${k}${i}`, src, surface });
        }
        const deadline = performance.now() + 20_000;
        while (kernel.isolates().some((s) => s.state !== 'running')) {
          if (performance.now() > deadline) throw new Error('isolates did not start');
          // oxlint-disable-next-line no-await-in-loop -- polling
          await new Promise((r) => setTimeout(r, 50));
        }
        // Idle a moment, so start-up garbage can go.
        await new Promise((r) => setTimeout(r, 1000));
        const report = await performance.measureUserAgentSpecificMemory();
        // One entry per worker realm; all workers share the bootstrap's URL.
        const perWorker = report.breakdown
          .filter((b) => b.attribution.some((a) => a.scope === 'DedicatedWorkerGlobalScope'))
          .map((b) => b.bytes);
        await kernel.destroy();
        document.getElementById('root')?.replaceChildren();
        return { perIsolateMB: perWorker.map((b) => b / 2 ** 20), workers: perWorker.length };
      },
      { kind, count: COUNT },
    );
    const medianMB = Number(median(m.perIsolateMB).toFixed(2));
    const targetMB = TARGET_MB[kind] ?? Number.NaN;
    results[kind] = {
      medianMB,
      targetMB,
      samples: m.perIsolateMB.map((x) => Number(x.toFixed(2))),
    };
    console.log(
      `${kind.padEnd(8)} ${medianMB.toFixed(2)} MB per isolate (median of ${m.workers} workers), target ≤ ${targetMB} MB${medianMB > targetMB ? '  OVER' : ''}`,
    );
  }
  await mkdir('bench-results', { recursive: true });
  await writeFile(
    'bench-results/memory-per-isolate.json',
    `${JSON.stringify({ count: COUNT, results }, null, 2)}\n`,
  );
});
