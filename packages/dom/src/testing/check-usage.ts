/*
 * The DOM usage check (ADR 0010, M3a task 2), for the adapters' test
 * projects: runs a usage fixture worker (see `./usage`), fails if the
 * framework reached for members the subset doesn't have, and compares the
 * log with the committed one. With `write`, it rewrites the committed log
 * instead (`pnpm dom:usage`).
 */
import { expect } from 'vitest';
import { commands } from 'vitest/browser';
import type { FixtureMessage, UsageLog } from './worker';

/**
 * Reads the subset doesn't serve, each with why that's fine. A read of an
 * absent member returns `undefined`, which these call sites handle.
 */
export const TOLERATED_MISSING: Readonly<Record<string, string>> = {
  moveBefore:
    'Preact 11 uses it when present and falls back to insertBefore, which already keeps node identity on the host (a `move` record).',
  contentEditable:
    'React checks `=== "true"` when it saves and restores the selection around a commit; nothing in an isolate is editable, so undefined reads right.',
  documentMode: 'React checks for old IE’s document mode; absent means a modern browser.',
  createEvent:
    'React 18 in development replays errors through a synthetic event when it can; without one it uses try/catch.',
  getRootNode:
    'React 19 uses it, when present, to find a shadow root to hoist into, and falls back to ownerDocument; the isolate tree has no shadow root of its own.',
  correspondingUseElement:
    'React reads it on event targets for old IE’s SVG <use> instances and falls back to the target itself.',
};

/**
 * Runs a usage fixture worker and checks its log. Fails the test if the
 * framework reached for members the subset doesn't have (other than
 * `TOLERATED_MISSING`), or if the log differs from the committed one. Runs in
 * Vitest's browser mode.
 *
 * @param worker A worker running a usage fixture (`trackUsage()`, then `reportUsage()`). It's terminated when the log arrives.
 * @param logPath The committed log, relative to the repo root, e.g. `packages/dom/usage/preact-10.json`.
 * @param write Rewrite the committed log with this run's before comparing.
 * @returns The log.
 * @throws {Error} when the fixture worker throws or fails to load.
 */
export async function checkDomUsage(
  worker: Worker,
  logPath: string,
  write: boolean,
): Promise<UsageLog> {
  const log = await new Promise<UsageLog>((resolve, reject) => {
    worker.addEventListener('message', (e: MessageEvent<FixtureMessage>) => {
      if (e.data.t === 'error') reject(new Error(`usage fixture threw: ${e.data.error}`));
      else if (e.data.t === 'usage') resolve(e.data.log);
    });
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      reject(new Error(`usage fixture failed: ${e.message}`));
    });
  }).finally(() => worker.terminate());

  const text = `${JSON.stringify(log, null, 2)}\n`;
  if (write) await commands.writeFile(logPath, text);

  const unserved = log.missing.filter((m) => !Object.hasOwn(TOLERATED_MISSING, m));
  expect(unserved, `${log.framework} uses members the subset lacks`).toEqual([]);
  // Compared as data: the formatter may lay the committed file out its own way.
  const committed: unknown = await commands
    .readFile(logPath)
    .then((t) => JSON.parse(t) as unknown)
    .catch(() => null);
  expect(log, `${logPath} is out of date: run pnpm dom:usage`).toEqual(committed);
  return log;
}
