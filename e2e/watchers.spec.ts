/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { HARNESS, ISOLATES_CORS } from './servers';

// The watchers' equivalence property end to end (ADR 0023, point 4; M8
// Watchers W1, task 6): on a quiet bus, a watcher holds the same value per key
// as a stream reader from `earliest` ends up with. Checked for a host watch
// (`kernel.watch`) and an isolate's (`ctx.bus.watch`) on a memory and a
// persistent topic, across a bus restart and a wake from suspension.

type Entries = [string | null, unknown][];

/** Entries in key order, so two views compare whatever order they came in. */
const sorted = (e: Entries): Entries =>
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy; the E2E lib is ES2022, without toSorted
  [...e].sort(([a], [b]) => String(a).localeCompare(String(b)));

test('a watcher holds what a replay from earliest ends with, across a bus restart and a wake', async ({
  page,
}) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  const out = await page.evaluate(
    async ({ contracts, src }) => {
      const TOPICS = ['watched.v1', 'watched-saved.v1'];
      const KEYS = ['a', 'b', 'c', 'd', undefined];
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the page, must be self-contained
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      /** What W went through, for a failure message. */
      const trail: string[] = [];
      const until = async (fn: () => boolean, what: string, ms = 8000) => {
        const end = performance.now() + ms;
        while (!fn()) {
          if (performance.now() > end)
            throw new Error(`timed out: ${what}; W: ${trail.join(' → ')}`);
          // oxlint-disable-next-line no-await-in-loop -- polling
          await sleep(20);
        }
      };
      const kernel = await window.harness.createBusKernel(contracts);
      await new Promise<void>((resolve) => kernel.on('bus:ready', () => resolve()));

      // The host's watches.
      const host = new Map<string, Entries>();
      for (const name of TOPICS) {
        kernel.watch({ name }, (view) => {
          host.set(name, [...view]);
        });
      }

      // The isolate's watches, reported on watch-view.v1.
      type Report = { instance: string; topic: string; view: Entries };
      const reports: Report[] = [];
      kernel.subscribe(
        { name: 'watch-view.v1' },
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture's shape
        (r) => reports.push(r.value as Report),
        { from: 'earliest' },
      );
      const state = () => kernel.isolates().find((s) => s.id === 'W')?.state;
      kernel.on('isolate:state', ({ id, state: st }) => void (id === 'W' && trail.push(st)));
      kernel.on(
        'isolate:crash',
        ({ id, reason, message }) => void (id === 'W' && trail.push(`crash ${reason}: ${message}`)),
      );
      kernel.spawn({
        id: 'W',
        src,
        grants: { publish: ['watch-view.v1'], subscribe: TOPICS },
        suspend: { whenIdle: { afterMs: 300 } },
        config: { topics: TOPICS },
      });
      await until(() => state() === 'running', 'W running');

      // Deterministic "random" publishes: a small LCG, so a failure replays.
      let seed = 7;
      // The low bits of this LCG cycle, so only its high bits are used.
      const next = () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return Math.floor(seed / 65_536);
      };
      let value = 0;
      const burst = async (n: number) => {
        for (let i = 0; i < n; i++) {
          const name = TOPICS[next() % TOPICS.length] ?? 'watched.v1';
          const key = KEYS[next() % KEYS.length];
          // oxlint-disable-next-line no-await-in-loop -- in order
          await kernel.publish({ name }, ++value, key === undefined ? {} : { key });
          // oxlint-disable-next-line no-await-in-loop -- a stream, not one task
          if (i % 10 === 0) await sleep(0);
        }
      };

      await burst(120);
      // A bus restart: the memory topic is lost, the persistent one comes back.
      const restarted = new Promise<void>((resolve) => kernel.on('bus:ready', () => resolve()));
      kernel.debug.crashBus();
      await restarted;
      await burst(60);

      // A wake: W suspends once quiet, and a record on a watched topic wakes it.
      await until(() => state() === 'suspended', 'W suspended');
      const first = reports.at(-1)?.instance;
      await burst(30);
      await until(() => reports.some((r) => r.instance !== first), 'W woken');
      await until(() => state() === 'running', 'W running again');

      // Quiet, then the replays.
      await sleep(1000);
      const replay = async (name: string): Promise<Entries> => {
        const latest = new Map<string | null, unknown>();
        const off = kernel.subscribe({ name }, (r) => latest.set(r.key ?? null, r.value), {
          from: 'earliest',
        });
        await sleep(500);
        off();
        return [...latest];
      };
      /** The woken instance's last view of `name`. */
      const isolate = (name: string): Entries => {
        for (let i = reports.length - 1; i >= 0; i--) {
          const r = reports[i];
          if (r && r.topic === name && r.instance !== first) return r.view;
        }
        return [];
      };
      const result = [];
      for (const name of TOPICS) {
        result.push({
          name,
          // oxlint-disable-next-line no-await-in-loop -- one reader at a time
          replay: await replay(name),
          host: host.get(name) ?? [],
          isolate: isolate(name),
        });
      }
      await kernel.destroy();
      return result;
    },
    {
      contracts: new URL('contracts.js', ISOLATES_CORS).href,
      src: new URL('watcher.js', ISOLATES_CORS).href,
    },
  );

  for (const t of out) {
    expect(t.replay.length, `${t.name} has values`).toBeGreaterThan(0);
    expect({ topic: t.name, held: sorted(t.host) }).toEqual({
      topic: t.name,
      held: sorted(t.replay),
    });
    expect({ topic: t.name, held: sorted(t.isolate) }).toEqual({
      topic: t.name,
      held: sorted(t.replay),
    });
  }
});
