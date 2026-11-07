import { mountFixture, SMOKE_STEPS, snapshot } from '@isoloop/dom/testing';
import { render } from 'preact';
import { afterEach, expect, test } from 'vitest';
import { App } from './__fixtures__/app';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

const tick = () => new Promise((r) => setTimeout(r, 10));

// M3a task 3: Preact in a real worker, rendering into the subset, gives the
// host the same DOM as Preact rendering the same app into the page.
test('Preact in a worker renders what Preact renders into the DOM', async () => {
  const host = mountFixture(
    new Worker(new URL('./__fixtures__/smoke.worker.tsx', import.meta.url), { type: 'module' }),
  );
  const real = document.createElement('div');
  document.body.append(real);
  render(<App />, real);
  cleanups.push(() => {
    render(null, real);
    real.remove();
    host.dispose();
  });

  await host.settled();
  expect(snapshot(host.container)).toEqual(snapshot(real));
  for (const step of SMOKE_STEPS) {
    step.act(real);
    step.act(host.container);
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all([host.settled(), tick()]);
    expect(snapshot(host.container), step.name).toEqual(snapshot(real));
  }
});
