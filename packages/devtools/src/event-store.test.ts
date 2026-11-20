import type { InspectEvent } from '@isoloop/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRecorder, KEEP_SESSIONS } from './event-store';

const ev = (
  at: number,
  event = 'isolate:ready',
  data: Record<string, unknown> = { id: 'a' },
): InspectEvent => ({
  at,
  event,
  data,
});

/** Waits until the recorder's storage holds `n` events of its session. */
const stored = (r: ReturnType<typeof createRecorder>, n: number) =>
  vi.waitFor(
    async () => {
      const s = (await r.sessions()).find((x) => x.id === r.session);
      if (s?.count !== n) throw new Error(`stored ${s?.count ?? 'none'}, want ${n}`);
    },
    { timeout: 4000, interval: 50 },
  );

describe('the events kept for the whole session', () => {
  beforeAll(async () => {
    await createRecorder().clear();
  });
  afterAll(async () => {
    await createRecorder().clear();
  });

  it('keeps events by host time and counts one that arrives twice once', () => {
    const r = createRecorder();
    r.add([ev(5), ev(5)]);
    r.add([ev(1, 'isolate:state', { id: 'a', state: 'running', prev: 'loading' })]);
    expect(r.events().map((e) => e.at)).toEqual([1, 5]);
    // Two different events at the same time are two events.
    r.add([ev(5, 'isolate:ready', { id: 'b' })]);
    expect(r.events()).toHaveLength(3);
  });

  it('counts the problems not acknowledged yet, and only the newer ones after an acknowledgement', () => {
    const r = createRecorder();
    r.add([ev(1), ev(2, 'isolate:crash', { id: 'a', reason: 'error', message: 'x' })]);
    r.add([ev(3, 'isolate:state', { id: 'a', state: 'blocked', prev: 'running' })]);
    expect(r.unacknowledged()).toBe(2);
    const seen = r.events().filter((e) => e.event === 'isolate:crash');
    expect(seen.every((e) => r.isNew(e))).toBe(true);

    r.acknowledge();
    expect(r.unacknowledged()).toBe(0);
    expect(seen.some((e) => r.isNew(e))).toBe(false);

    r.add([ev(4, 'isolate:failed', { id: 'a', reason: 'error', message: 'y' }), ev(5)]);
    expect(r.unacknowledged()).toBe(1);
  });

  it('stores them, and a later session can read them back', async () => {
    const first = createRecorder();
    first.add([ev(1), ev(2, 'isolate:state', { id: 'a', state: 'running', prev: 'loading' })]);
    // A problem is written at once; the rest wait a moment to be written together.
    first.add([ev(3, 'isolate:failed', { id: 'a', reason: 'error', message: 'boom' })]);
    await stored(first, 3);

    const later = createRecorder();
    const sessions = await later.sessions();
    const earlier = sessions.find((s) => s.id === first.session);
    expect(earlier?.count).toBe(3);
    const rows = await later.load(first.session);
    expect(rows.map((e) => e.at)).toEqual([1, 2, 3]);
    expect(rows[2]?.data['message']).toBe('boom');
    expect(typeof rows[0]?.wall).toBe('number');
  });

  it('keeps only the last few sessions', async () => {
    const made: ReturnType<typeof createRecorder>[] = [];
    for (let i = 0; i < KEEP_SESSIONS + 2; i++) {
      const r = createRecorder();
      r.add([ev(i, 'isolate:failed', { id: `s${i}`, reason: 'error', message: 'x' })]);
      // oxlint-disable-next-line no-await-in-loop -- each session starts after the last was written
      await stored(r, 1);
      made.push(r);
      // oxlint-disable-next-line no-await-in-loop -- session ids and start times need to differ
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const kept = (await createRecorder().sessions()).map((s) => s.id);
    expect(kept).toContain(made.at(-1)?.session);
    expect(kept).not.toContain(made[0]?.session);
    expect(kept.length).toBeLessThanOrEqual(KEEP_SESSIONS + 1);
  });

  it('forgets everything on clear, keeping this session going', async () => {
    const r = createRecorder();
    r.add([ev(1, 'isolate:failed', { id: 'a', reason: 'error', message: 'x' })]);
    await stored(r, 1);
    await r.clear();
    expect(r.events()).toHaveLength(0);
    const after = await r.sessions();
    expect(after.map((s) => s.id)).toEqual([r.session]);
    expect(after[0]?.count).toBe(0);
  });
});
