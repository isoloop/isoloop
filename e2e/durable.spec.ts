/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// Persistent topics end to end (plan m2b-durable-log). Only one tab's bus
// owns the origin's OPFS files (ADR 0007, decision 6).

const CONTRACTS = new URL('contracts.js', ISOLATES_CORS).href;
const saved = { name: 'saved.v1' };

/** Loads the harness and starts a kernel with a bus; resolves with what `bus:durability-degraded` said by `ready`. */
async function boot(page: Page): Promise<string[]> {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  return page.evaluate(async (contracts) => {
    const kernel = await window.harness.createBusKernel(contracts);
    const degraded: string[] = [];
    kernel.on('bus:durability-degraded', ({ reason }) => degraded.push(reason));
    window.durable = { kernel, degraded };
    await new Promise<void>((resolve) => kernel.on('bus:ready', () => resolve()));
    // The degraded event follows `ready` in the same message.
    await new Promise((r) => setTimeout(r, 0));
    return degraded;
  }, CONTRACTS);
}

/** Publishes to the persistent topic, then reads it from the start. */
function publishAndRead(page: Page, n: number): Promise<unknown[]> {
  return page.evaluate(
    async ({ topic, value }) => {
      const kernel = window.durable?.kernel;
      if (!kernel) throw new Error('no kernel');
      await kernel.publish(topic, { value });
      const got: unknown[] = [];
      const off = kernel.subscribe(topic, (r) => got.push(r.value), { from: 'earliest' });
      await new Promise((r) => setTimeout(r, 300));
      off();
      return got;
    },
    { topic: saved, value: n },
  );
}

/** Every value on the persistent topic, from the start. */
function readAll(page: Page): Promise<unknown[]> {
  return page.evaluate(async (topic) => {
    const kernel = window.durable?.kernel;
    if (!kernel) throw new Error('no kernel');
    const values: unknown[] = [];
    const off = kernel.subscribe(topic, (r) => values.push(r.value), { from: 'earliest' });
    await new Promise((r) => setTimeout(r, 500));
    off();
    return values;
  }, saved);
}

/**
 * Publishes 0…n-1 to the persistent topic as a steady stream, killing the
 * bus worker once `killAt` were sent. Resolves with the acknowledged values,
 * and with any that rejected.
 */
function streamThroughCrash(
  page: Page,
  n: number,
  killAt: number,
): Promise<{ acked: number[]; rejected: string[] }> {
  return page.evaluate(
    async ({ topic, total, kill }) => {
      const kernel = window.durable?.kernel;
      if (!kernel) throw new Error('no kernel');
      const restarted = new Promise<void>((resolve) => kernel.on('bus:ready', () => resolve()));
      const acked: number[] = [];
      const rejected: string[] = [];
      const sent: Promise<void>[] = [];
      for (let i = 0; i < total; i++) {
        sent.push(
          kernel.publish(topic, { value: i }).then(
            () => void acked.push(i),
            (e: unknown) => void rejected.push(String(e)),
          ),
        );
        if (i === kill) kernel.debug.crashBus();
        // oxlint-disable-next-line no-await-in-loop -- a stream, not one burst
        if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      await Promise.all(sent);
      await restarted;
      return { acked, rejected };
    },
    { topic: saved, total: n, kill: killAt },
  );
}

test('I12: a persistent topic loses no acknowledged record when the bus worker is killed mid-stream', async ({
  page,
}) => {
  const first = await boot(page);
  test.skip(first.includes('open-failed'), 'no OPFS in this browser build');
  const n = 1000;
  const { acked, rejected } = await streamThroughCrash(page, n, 300);
  expect(rejected).toEqual([]);
  expect(acked.length).toBe(n);
  // Every acknowledged record, once each, in publish order: the ones the
  // dead bus never answered were sent again and not appended twice.
  expect(await readAll(page)).toEqual(Array.from({ length: n }, (_, i) => i));
});

test('I12: a persistent topic loses no acknowledged record when the page is reloaded', async ({
  page,
}) => {
  const first = await boot(page);
  test.skip(first.includes('open-failed'), 'no OPFS in this browser build');
  await page.evaluate(async (topic) => {
    const kernel = window.durable?.kernel;
    if (!kernel) throw new Error('no kernel');
    await Promise.all(Array.from({ length: 500 }, (_, i) => kernel.publish(topic, { value: i })));
  }, saved);
  // Reloading drops the old page; its bus worker lets go of the lock a moment later.
  await expect(async () => {
    expect(await boot(page)).toEqual([]);
  }).toPass({ timeout: 10_000 });
  expect(await readAll(page)).toEqual(Array.from({ length: 500 }, (_, i) => i));
  // And it keeps appending after what it restored.
  expect(await publishAndRead(page, 500)).toEqual(Array.from({ length: 501 }, (_, i) => i));
});

test('a second tab runs in memory with bus:durability-degraded; after the first closes, a reload takes the files', async ({
  context,
  page,
}) => {
  const first = await boot(page);
  // Playwright's WebKit has no OPFS, so no tab gets the files there (M2b task 15).
  test.skip(first.includes('open-failed'), 'no OPFS in this browser build');
  expect(first).toEqual([]);
  expect(await publishAndRead(page, 1)).toEqual([1]);

  const second = await context.newPage();
  expect(await boot(second)).toEqual(['another-tab']);
  // It works, in memory: it doesn't see the first tab's record.
  expect(await publishAndRead(second, 2)).toEqual([2]);

  await page.close();
  // The closed tab's bus worker lets go of the lock a moment later.
  await expect(async () => {
    expect(await boot(second)).toEqual([]);
  }).toPass({ timeout: 10_000 });
  // Now on disk: the first tab's record is there, the second's in-memory one isn't.
  expect(await publishAndRead(second, 3)).toEqual([1, 3]);
});

test('a record published just before the page freezes and is discarded is on disk after the reload', async ({
  page,
}) => {
  const first = await boot(page);
  test.skip(first.includes('open-failed'), 'no OPFS in this browser build');
  await page.evaluate((topic) => {
    const kernel = window.durable?.kernel;
    if (!kernel) throw new Error('no kernel');
    // Not awaited: the page freezes right after the publish.
    void kernel.publish(topic, { value: 42 });
    document.dispatchEvent(new Event('freeze'));
  }, saved);
  // Give the flush a moment, then drop the page as a discard would.
  await page.waitForTimeout(100);
  // Loading the page again drops the old one; its bus worker lets go of the lock a moment later.
  await expect(async () => {
    expect(await boot(page)).toEqual([]);
  }).toPass({ timeout: 10_000 });
  const got = await page.evaluate(async (topic) => {
    const kernel = window.durable?.kernel;
    if (!kernel) throw new Error('no kernel');
    const values: unknown[] = [];
    const off = kernel.subscribe(topic, (r) => values.push(r.value), { from: 'earliest' });
    await new Promise((r) => setTimeout(r, 300));
    off();
    return values;
  }, saved);
  expect(got).toEqual([42]);
});
