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
