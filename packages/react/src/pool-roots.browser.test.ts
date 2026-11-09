import { mountMembers } from '@isoloop/dom/testing';
import { afterEach, expect, test } from 'vitest';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

// M2d task 2 (ADR 0015): two React members share one worker and one
// document, each rendering into its own root; each surface gets only its
// member's records and its clicks reach only that member.
test('two React members in one worker render into two surfaces', async () => {
  const worker = new Worker(new URL('./__fixtures__/two-members.worker.tsx', import.meta.url), {
    type: 'module',
  });
  const surfaces = mountMembers(worker, 2);
  cleanups.push(() => {
    worker.terminate();
    for (const s of surfaces) s.remove();
  });
  const text = (i: number) => surfaces[i]?.textContent;
  const button = (i: number) => {
    const b = surfaces[i]?.querySelector('button');
    if (!b) throw new Error(`no button in surface ${i}`);
    return b;
  };

  await expect.poll(() => [text(0), text(1)]).toEqual(['A:0', 'B:0']);
  button(0).click();
  button(0).click();
  button(1).click();
  await expect.poll(() => [text(0), text(1)]).toEqual(['A:2', 'B:1']);
});

// M2d task 3: a render error in one member is caught at its root and reported
// as that member's own; the other member keeps rendering, and its modal lands
// in its portal root, inside its own surface.
test("a member's render error stays its own, and its neighbour's modal lands in its own surface", async () => {
  const worker = new Worker(new URL('./__fixtures__/pool-members.worker.tsx', import.meta.url), {
    type: 'module',
  });
  const reported: { member: number; message: string }[] = [];
  worker.addEventListener('message', (e: MessageEvent<unknown>) => {
    const d = e.data;
    if (typeof d === 'object' && d !== null && Reflect.get(d, 't') === 'reported') {
      reported.push({
        member: Number(Reflect.get(d, 'member')),
        message: String(Reflect.get(d, 'message')),
      });
    }
  });
  const surfaces = mountMembers(worker, 2);
  cleanups.push(() => {
    worker.terminate();
    for (const s of surfaces) s.remove();
  });

  await expect.poll(() => reported.length, { timeout: 3000 }).toBe(1);
  expect(reported[0]).toEqual({ member: 0, message: 'Error: A failed at 10' });
  // A's tree is gone; B keeps ticking.
  await expect.poll(() => surfaces[0]?.querySelector('p')).toBeNull();
  await expect.poll(() => surfaces[1]?.querySelector('p')?.dataset['ticks']).toBe('many');
  const modal = surfaces[1]?.querySelector('[data-isoloop-portal] dialog');
  expect(modal?.textContent).toBe('modal of B');
  expect(surfaces[0]?.querySelector('dialog')).toBeNull();
});
