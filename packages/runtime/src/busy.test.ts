/*
 * The busy ledger (ADR 0017): frames bill their owner, nested frames bill
 * their own, a frame that reports roots splits among them, a callback
 * registered in a frame belongs to the next root it reports, and sums stay
 * close to the truth under a browser's coarse clock.
 */
import { describe, expect, it } from 'vitest';
import { createBusy } from './busy';

/** A clock the test moves by hand. */
function clock(resolutionMs = 0) {
  let t = 0;
  return {
    now: () => (resolutionMs > 0 ? Math.floor(t / resolutionMs) * resolutionMs : t),
    spend(ms: number) {
      t += ms;
    },
  };
}

describe('the busy ledger', () => {
  it("bills a frame to its owner, and a nested frame to its own, not its parent's", () => {
    const c = clock();
    const busy = createBusy(c.now);
    busy.run(
      busy.of('a'),
      () => {
        c.spend(2);
        busy.run(busy.of('b'), () => c.spend(5), undefined, []);
        c.spend(3);
      },
      undefined,
      [],
    );
    expect(busy.take('a')).toBeCloseTo(5);
    expect(busy.take('b')).toBeCloseTo(5);
    // Taken: zero until more is billed.
    expect(busy.take('a')).toBe(0);
  });

  it('ends the frame when the code throws, and rethrows', () => {
    const c = clock();
    const busy = createBusy(c.now);
    expect(() =>
      busy.run(
        busy.of('a'),
        () => {
          c.spend(4);
          throw new Error('boom');
        },
        undefined,
        [],
      ),
    ).toThrow('boom');
    expect(busy.take('a')).toBeCloseTo(4);
    // No frame left open: a registration now belongs to nobody.
    expect(busy.capture().key).toBeNull();
  });

  it('splits a frame that reports roots equally among them', () => {
    const c = clock();
    const busy = createBusy(c.now);
    busy.run(
      busy.of('scheduler'),
      () => {
        c.spend(3);
        busy.report('a');
        c.spend(3);
        busy.report('b');
        busy.report('a');
      },
      undefined,
      [],
    );
    expect(busy.take('a')).toBeCloseTo(3);
    expect(busy.take('b')).toBeCloseTo(3);
    expect(busy.take('scheduler')).toBe(0);
  });

  it('gives a callback registered in a frame to the next root it reports, else to the owner', () => {
    const busy = createBusy(clock().now);
    let first = busy.capture();
    let second = busy.capture();
    let third = busy.capture();
    busy.run(
      { key: null, life: null },
      () => {
        first = busy.capture();
        busy.report('a');
        second = busy.capture();
        busy.report('b');
        third = busy.capture();
      },
      undefined,
      [],
    );
    expect([first.key, second.key, third.key]).toEqual(['a', 'b', null]);
    const fourth = { value: busy.capture() };
    busy.run(
      busy.of('c'),
      () => {
        fourth.value = busy.capture();
      },
      undefined,
      [],
    );
    expect(fourth.value.key).toBe('c');
  });

  it('bills nobody for a frame owned by nobody that reports no root', () => {
    const c = clock();
    const busy = createBusy(c.now);
    busy.run({ key: null, life: null }, () => c.spend(10), undefined, []);
    expect(busy.take(undefined)).toBe(0);
  });

  it('keeps sums close under a 100 µs clock, for many callbacks far shorter than a tick', () => {
    // A browser that isn't cross-origin isolated rounds `performance.now()`
    // to 100 µs. A 20 µs callback then reads as 0 or 100 µs, depending on
    // where it starts between ticks; over many, the sum comes out right.
    const c = clock(0.1);
    const busy = createBusy(c.now);
    let seed = 42;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const n = 20_000;
    const each = 0.02;
    for (let i = 0; i < n; i++) {
      c.spend(random() * 0.5);
      busy.run(busy.of('a'), () => c.spend(each), undefined, []);
    }
    const truth = n * each;
    expect(Math.abs(busy.take('a') - truth) / truth).toBeLessThan(0.05);
  });

  it('gives a callback the life of the member it is billed to, and a restart a new one', () => {
    const c = clock();
    const busy = createBusy(c.now);
    const first = busy.begin('a');
    let viaFrame = busy.capture();
    let viaRoot = busy.capture();
    busy.run(
      busy.of('a'),
      () => {
        viaFrame = busy.capture();
      },
      undefined,
      [],
    );
    busy.run(
      busy.of('scheduler', null),
      () => {
        viaRoot = busy.capture();
        busy.report('a');
      },
      undefined,
      [],
    );
    expect(viaFrame.life).toBe(first);
    expect(viaRoot.life).toBe(first);
    const second = busy.begin('a');
    busy.end(first);
    expect(first.ended).toBe(true);
    expect(second.ended).toBe(false);
    // Ending the old instance after the new one began leaves the new one current.
    expect(busy.of('a').life).toBe(second);
    busy.end(second);
    expect(busy.of('a').life).toBe(null);
  });
});
