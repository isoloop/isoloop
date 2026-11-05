/// <reference lib="dom" />
/*
 * Click-to-paint bench, first cut (plan m1-kernel, task 13; design §9).
 *
 * 100 clicks on a counter rendered by an isoloop-dom isolate, then 100 on the
 * same counter rendered directly on the main thread, in Chromium, Firefox and
 * WebKit, in two variants:
 * - `aligned`: Playwright clicks as soon as it can, which in practice lands a
 *   few ms after a frame, so the wait for the next frame looks long;
 * - `random`: each click waits for a frame plus a random 0–16 ms first, so
 *   clicks land at any point in the frame, as a user's do.
 * Each sample is the time
 * from the host's `pointerdown` to the animation frame that paints the new
 * count. For the isolate, the compositor writes the change inside that frame's
 * rAF callback; on the main thread, the click handler writes it and the next
 * rAF callback is that frame. Ending both at the frame keeps the comparison
 * fair: a main-thread change isn't on screen until the next frame either
 * (docs/investigations/click-to-paint-latency.md). Report only, no threshold
 * yet. Budget (design §9): p95 overhead ≤ 1 frame on Chromium, whose
 * `DeferRendererTasksAfterInput` holds the worker's patch past the next frame,
 * and ≤ 8 ms on Firefox and WebKit. Firefox and WebKit coarsen timers to whole
 * milliseconds, so their numbers are whole ms.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import '../../e2e/harness-types';
import { HARNESS } from '../../e2e/servers';

const CLICKS = 100;
const FRAME_MS = 1000 / 60;
const VARIANTS = ['aligned', 'random'] as const;
type Variant = (typeof VARIANTS)[number];

/** The counter isolate, as module source: spawned from a blob URL. */
const COUNTER = `
export default {
  start(ctx) {
    let n = 0;
    const count = document.createElement('span');
    count.setAttribute('class', 'count');
    count.textContent = '0';
    const button = document.createElement('button');
    button.textContent = '+';
    button.addEventListener('click', () => {
      n++;
      count.textContent = String(n);
    });
    ctx.root.append(button, count);
  },
};
`;

const round = (x: number): number => Math.round(x * 100) / 100;

type Stats = { n: number; p50: number; p95: number; p99: number; max: number; mean: number };

const stats = (xs: number[]): Stats => {
  const s = [...xs];
  s.sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Number.NaN;
  return {
    n: s.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(s.at(-1) ?? Number.NaN),
    mean: round(s.reduce((a, b) => a + b, 0) / s.length),
  };
};

/**
 * Arms a recorder in the page: pointerdown on `root` starts a sample; the frame
 * that paints the counter's change ends it. For the isolate that's the
 * compositor's rAF (the change itself); on the main thread, the rAF after it.
 */
const arm = (page: Page, which: 'isolate' | 'main') =>
  page.evaluate((side) => {
    const section = document.getElementById(side);
    const root = side === 'isolate' ? section?.querySelector('iso-surface')?.shadowRoot : section;
    if (!root) throw new Error(`no ${side} counter`);
    const samples: number[] = [];
    const clickGaps: number[] = [];
    // Where in the frame each pointerdown lands: ms since the last rAF.
    const phases: number[] = [];
    let lastFrame = performance.now();
    const tick = (t: number): void => {
      lastFrame = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    let start = -1;
    root.addEventListener(
      'pointerdown',
      (e) => {
        start = e.timeStamp;
        phases.push(e.timeStamp - lastFrame);
      },
      { capture: true },
    );
    // When the browser delivers `click` after `pointerdown`: input latency, not ours.
    root.addEventListener(
      'click',
      (e) => {
        if (start >= 0) clickGaps.push(e.timeStamp - start);
      },
      { capture: true },
    );
    const end = (): void => {
      if (start < 0) return;
      samples.push(performance.now() - start);
      start = -1;
    };
    new MutationObserver(() => {
      if (side === 'isolate') end();
      else requestAnimationFrame(end);
    }).observe(root, { subtree: true, childList: true, characterData: true });
    Object.assign(window, { [`samples_${side}`]: { samples, clickGaps, phases } });
  }, which);

const numbers = (x: unknown): number[] =>
  Array.isArray(x) ? x.filter((n): n is number => typeof n === 'number') : [];

type Run = { samples: number[]; clickGaps: number[]; phases: number[] };

/** Waits for a frame, then a random 0–16 ms, so the next click lands anywhere in the frame. */
const somewhereInFrame = (page: Page) =>
  page.evaluate(
    (frameMs) =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, Math.random() * frameMs));
      }),
    FRAME_MS,
  );

async function run(page: Page, which: 'isolate' | 'main', variant: Variant): Promise<Run> {
  await arm(page, which);
  const button = page.locator(`#${which} button`);
  const count = page.locator(`#${which} .count`);
  for (let i = 1; i <= CLICKS; i++) {
    // One click at a time: each waits for its own paint.
    // oxlint-disable-next-line no-await-in-loop
    if (variant === 'random') await somewhereInFrame(page);
    // oxlint-disable-next-line no-await-in-loop
    await button.click();
    // oxlint-disable-next-line no-await-in-loop
    await expect(count).toHaveText(String(i));
    // The sample ends a frame after the text changes on the main thread: wait
    // for it, so the next pointerdown can't start before this one ends.
    // oxlint-disable-next-line no-await-in-loop
    await expect
      .poll(() =>
        page.evaluate((side): number => {
          const rec: unknown = Reflect.get(window, `samples_${side}`);
          const xs: unknown = typeof rec === 'object' && rec ? Reflect.get(rec, 'samples') : null;
          return Array.isArray(xs) ? xs.length : -1;
        }, which),
      )
      .toBe(i);
  }
  const out: unknown = await page.evaluate(
    (side): unknown => Reflect.get(window, `samples_${side}`),
    which,
  );
  if (typeof out !== 'object' || out === null) throw new Error('no samples');
  return {
    samples: numbers(Reflect.get(out, 'samples')),
    clickGaps: numbers(Reflect.get(out, 'clickGaps')),
    phases: numbers(Reflect.get(out, 'phases')),
  };
}

for (const variant of VARIANTS) {
  test(`click-to-paint (${variant}): isolate vs main thread`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.goto(HARNESS);
    await expect(page.locator('body[data-ready]')).toBeAttached();
    await page.evaluate((code) => {
      const root = document.getElementById('root');
      // The isolate's counter.
      const iso = document.createElement('section');
      iso.id = 'isolate';
      root?.append(iso);
      const src = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      window.harness.createKernel().spawn({ id: 'counter', src, surface: iso });
      // The same counter on the main thread.
      const main = document.createElement('section');
      main.id = 'main';
      const button = document.createElement('button');
      button.textContent = '+';
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = '0';
      let n = 0;
      button.addEventListener('click', () => {
        n++;
        count.textContent = String(n);
      });
      main.append(button, count);
      root?.append(main);
    }, COUNTER);
    await expect(page.locator('#isolate .count')).toHaveText('0');

    const iso = await run(page, 'isolate', variant);
    const mt = await run(page, 'main', variant);
    const isolate = stats(iso.samples);
    const main = stats(mt.samples);
    const overhead = {
      p50: Math.round((isolate.p50 - main.p50) * 100) / 100,
      p95: Math.round((isolate.p95 - main.p95) * 100) / 100,
    };
    const browser = info.project.name;
    const chromium = browser === 'chromium';
    const report = {
      bench: 'click-to-paint',
      browser,
      variant,
      clicks: CLICKS,
      unit: 'ms, pointerdown → the frame that paints the new count',
      resolution: chromium ? 'sub-ms' : 'whole ms (the browser coarsens timers)',
      isolate,
      main,
      overhead,
      /** pointerdown → click as the browser delivers it, in both runs: part of every sample. */
      clickGap: { isolate: stats(iso.clickGaps), main: stats(mt.clickGaps) },
      /** ms since the last frame when pointerdown arrived: shows where clicks land. */
      phase: stats([...iso.phases, ...mt.phases]),
      /** Design §9: one frame on Chromium, 8 ms on Firefox and WebKit. Report only. */
      budget: chromium
        ? { p95Overhead: '1 frame', p95OverheadMs: round(FRAME_MS), enforced: false }
        : { p95Overhead: '8 ms', p95OverheadMs: 8, enforced: false },
      withinBudget: overhead.p95 <= (chromium ? FRAME_MS : 8),
    };
    console.log(
      `click-to-paint ${browser}/${variant}: isolate p50 ${isolate.p50} / p95 ${isolate.p95} ms, ` +
        `main p50 ${main.p50} / p95 ${main.p95} ms, overhead p50 ${overhead.p50} / p95 ${overhead.p95} ms` +
        (chromium ? '' : ' (whole ms)'),
    );
    console.log(JSON.stringify(report, null, 2));
    await info.attach('click-to-paint.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    await mkdir('bench-results', { recursive: true });
    await writeFile(
      `bench-results/click-to-paint-${browser}-${variant}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    expect(isolate.n).toBe(CLICKS);
    expect(main.n).toBe(CLICKS);
  });
}
