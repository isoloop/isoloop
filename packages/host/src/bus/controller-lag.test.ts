// The bus worker's heartbeat kill on the host's lag clock (ADR 0007,
// *the heartbeat clock is the host's lag*): a stand-in bus that sends `ready`
// and never beats, with ticks and the host's lag fed by the test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import list from '../__fixtures__/contracts';
import { createBusController, type BusController } from './controller';
import { DEFAULT_SUPERVISOR_CONFIG, WALL_CAP } from '../supervisor/machine';

const silentBus = URL.createObjectURL(
  new Blob(
    [
      `self.addEventListener('message', (e) => {
        if (e.data && e.data.t === 'boot') self.postMessage({ v: 1, t: 'ready', p: {} });
      });`,
    ],
    { type: 'text/javascript' },
  ),
);

const noop = (): void => {};
const controllers: BusController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.destroy();
});

const KILL_MS = 1000;

async function setup() {
  let lag = 0;
  let readyAt = 0;
  const crashes: string[] = [];
  const c = createBusController({
    workerUrl: silentBus,
    contracts: { url: 'about:blank', list },
    heartbeatMs: 100,
    supervisor: { ...DEFAULT_SUPERVISOR_CONFIG, blockedAfterMs: 100, killAfterMs: KILL_MS },
    hostLagMs: () => lag,
    dev: false,
    events: {
      ready: () => {
        readyAt = performance.now();
      },
      recovered: noop,
      degraded: noop,
      crash: (reason, message) => crashes.push(`${reason}: ${message}`),
      restart: noop,
      failed: noop,
      metrics: noop,
      reattach: noop,
      wake: noop,
      seed: noop,
      orphaned: noop,
    },
  });
  controllers.push(c);
  await vi.waitUntil(() => readyAt > 0);
  return {
    c,
    crashes,
    /** A tick `ms` after the bus's `ready`, with the host's lag total at `hostLag`. */
    tickAt: (ms: number, hostLag: number): void => {
      lag = hostLag;
      c.feed({ k: 'tick', at: readyAt + ms });
    },
  };
}

describe('bus worker: the heartbeat clock', () => {
  it('a silence that is mostly host lag is not a kill', async () => {
    const { crashes, tickAt } = await setup();
    tickAt(200, 0); // blocked
    tickAt(2000, 1500); // 2 s on the wall, 0.5 s heard
    expect(crashes).toEqual([]);
  });

  it('the same silence on a host that was on time is a kill', async () => {
    const { crashes, tickAt } = await setup();
    tickAt(200, 0);
    tickAt(2000, 0);
    expect(crashes).toEqual([`unresponsive: No heartbeat for ${KILL_MS} ms`]);
  });

  it('a silence past the wall-clock cap is a kill whatever the lag', async () => {
    const { crashes, tickAt } = await setup();
    tickAt(200, 0);
    tickAt(KILL_MS * WALL_CAP + 100, KILL_MS * WALL_CAP);
    expect(crashes).toEqual([`unresponsive: No heartbeat for ${KILL_MS * WALL_CAP} ms`]);
  });
});
