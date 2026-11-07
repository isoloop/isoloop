import { mountFixture } from '@isoloop/dom/testing';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { Checkbox } from './__fixtures__/checkbox';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const box = (root: Element): HTMLInputElement => {
  const el = root.querySelector('input[name="box"]');
  if (!(el instanceof HTMLInputElement)) throw new Error('no checkbox');
  return el;
};

// A controlled checkbox whose state arrives after the click (from a topic,
// in the markets dashboard) is drawn the same as React draws it in the page.
test('a controlled checkbox updated later is drawn as React draws it', async () => {
  const host = mountFixture(
    new Worker(new URL('./__fixtures__/checkbox.worker.tsx', import.meta.url), {
      type: 'module',
    }),
  );
  const real = document.createElement('div');
  document.body.append(real);
  const root = createRoot(real);
  root.render(<Checkbox />);
  cleanups.push(() => {
    root.unmount();
    real.remove();
    host.dispose();
  });
  await Promise.all([host.settled(), wait(30)]);
  expect([box(host.container).checked, box(real).checked]).toEqual([true, true]);

  for (const want of [false, true, false]) {
    box(real).click();
    box(host.container).click();
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all([host.settled(60), wait(120)]);
    expect(box(real).checked, 'React in the page').toBe(want);
    expect(box(host.container).checked, 'React in a worker').toBe(want);
  }
});
