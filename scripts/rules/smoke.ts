// `pnpm rules:smoke` (ADR 0026, amended 2026-11-28): builds the rules page and
// the specimen, then opens every tab in headless Chromium at 2 widths in both
// themes. It fails on a console error, a page error, a sideways scroll or an
// empty view, and opens one rule's drawer on each run. No pixel snapshots.
// It runs in ci.yml's browser job, where Chromium is installed.
/* oxlint-disable no-await-in-loop -- one page at a time, so each run sees a fresh browser page and failures read in order */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { boardData, readBoardSources, renderBoard } from './build.ts';
import { REPO_ROOT } from './config.ts';
import { readAdrs, readRegistry } from './registry.ts';

export const WIDTHS = [1280, 400] as const;
export const THEMES = ['light', 'dark'] as const;

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'rules-smoke-'));
  const data = boardData(readRegistry(REPO_ROOT), readAdrs(REPO_ROOT));
  const pages = [
    { name: 'board', path: join(dir, 'index.html'), specimen: false },
    { name: 'specimen', path: join(dir, 'specimen.html'), specimen: true },
  ];
  for (const p of pages)
    writeFileSync(p.path, renderBoard(readBoardSources({ specimen: p.specimen }), data));

  const failures: string[] = [];
  let runs = 0;
  const browser = await chromium.launch();
  try {
    for (const page of pages)
      for (const width of WIDTHS)
        for (const theme of THEMES) {
          const tab = await browser.newPage({
            viewport: { width, height: 900 },
            colorScheme: theme,
          });
          const errors: string[] = [];
          tab.on('pageerror', (e) => errors.push(String(e)));
          tab.on('console', (m) => {
            if (m.type() === 'error') errors.push(m.text());
          });
          await tab.goto(`file://${page.path}`);
          const views = await tab.$$eval('[data-view]', (bs) =>
            bs.map((b) => (b instanceof HTMLElement ? (b.dataset['view'] ?? '') : '')),
          );
          if (views.length === 0) failures.push(`${page.name}: no tabs`);
          for (const v of views) {
            const where = `${page.name} #${v} at ${width}px, ${theme}`;
            await tab.click(`[data-view="${v}"]`);
            const overflow = await tab.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            );
            if (overflow > 0) failures.push(`${where}: scrolls sideways by ${overflow}px`);
            const children = await tab.$eval('#view', (el) => el.childElementCount);
            if (children === 0) failures.push(`${where}: the view is empty`);
            runs++;
          }
          if (!page.specimen) {
            const card = tab.locator('[data-id]').first();
            if ((await card.count()) > 0) {
              await card.click();
              if ((await tab.locator('[role="dialog"]').count()) !== 1)
                failures.push(`${page.name} at ${width}px, ${theme}: the drawer didn't open`);
              await tab.keyboard.press('Escape');
            }
          }
          for (const e of errors) failures.push(`${page.name} at ${width}px, ${theme}: ${e}`);
          await tab.close();
        }
  } finally {
    await browser.close();
  }
  for (const f of failures) console.log(`error   ${f}`);
  console.log(
    failures.length === 0
      ? `rules:smoke passed: ${runs} view runs`
      : `rules:smoke: ${failures.length} problem(s)`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
