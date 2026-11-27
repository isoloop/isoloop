import type { TopicRef } from '@isoloop/protocol';
import { createTestContext } from '@isoloop/runtime/testing';
import type { JSX } from 'preact';
import { Suspense } from 'preact/compat';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { defineIsolate, useWatch } from '../index';

// M8 Watchers W1 task 5: useWatch, both forms, `seen` only after commit.

const prices: TopicRef<string> = { name: 'prices', schema: { '~standard': {} } };

const roots: HTMLElement[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) r.remove();
});

/** Each view's `onView` promise, and whether it has settled. */
type Settles = { settled: boolean }[];

function mount(Component: () => JSX.Element) {
  const root = document.createElement('div');
  document.body.append(root);
  roots.push(root);
  const t = createTestContext({ root });
  const settles: Settles = [];
  const watch = t.ctx.bus.watch.bind(t.ctx.bus);
  t.ctx.bus.watch = (topic, onView, opts) =>
    watch(
      topic,
      (view, changed) => {
        const s = { settled: false };
        settles.push(s);
        const done = onView(view, changed);
        void Promise.resolve(done).then(() => {
          s.settled = true;
        });
        return done;
      },
      opts,
    );
  void defineIsolate(Component).start(t.ctx);
  return { ...t, root, settles };
}

const settle = () => new Promise((r) => setTimeout(r, 30));
const text = (root: HTMLElement, cls: string) =>
  [...root.querySelectorAll(`.${cls}`)].map((e) => e.textContent);

function All({ cls = 'all' }: { cls?: string }) {
  const view = useWatch(prices);
  return <p class={cls}>{[...view].map(([k, v]) => `${k ?? '-'}=${v}`).join(',')}</p>;
}

function One({ k, cls = 'one' }: { k: string | null; cls?: string }) {
  const v = useWatch(prices, { key: k });
  return <p class={cls}>{v ?? 'none'}</p>;
}

let show: ((n: number) => void) | undefined;
function Many({ initial = 2 }: { initial?: number }) {
  const [n, setN] = useState(initial);
  show = setN;
  return (
    <div>
      {Array.from({ length: n }, (_, i) => (
        <All key={i} />
      ))}
    </div>
  );
}

const never = new Promise<never>(() => {});
function Suspends() {
  const v = useWatch(prices, { key: 'a' });
  // oxlint-disable-next-line typescript/only-throw-error -- a thrown promise is how a render suspends
  if (v === 'stall') throw never;
  return <p class="s">{v ?? 'none'}</p>;
}

describe('Preact adapter: useWatch (M8 Watchers W1)', () => {
  it('two components on one topic both show every key, through one watch', async () => {
    const { root, emit, watches } = mount(() => <Many />);
    await settle();
    expect(watches()).toEqual([{ topic: 'prices', keys: undefined }]);
    emit('prices', '1', 'a');
    emit('prices', '2', 'b');
    await settle();
    expect(text(root, 'all')).toEqual(['a=1,b=2', 'a=1,b=2']);
    show?.(1);
    await settle();
    expect(watches()).toHaveLength(1);
    show?.(0);
    await settle();
    expect(watches()).toEqual([]);
  });

  it('one that mounts later shows the current view at once', async () => {
    const { root, emit, watches } = mount(() => <Many initial={1} />);
    await settle();
    emit('prices', '3', 'a');
    await settle();
    show?.(2);
    await settle();
    expect(text(root, 'all')).toEqual(['a=3', 'a=3']);
    expect(watches()).toHaveLength(1);
  });

  it('one key: only that key, watched on its own', async () => {
    const { root, emit, watches } = mount(() => <One k="a" />);
    await settle();
    expect(watches()).toEqual([{ topic: 'prices', keys: ['a'] }]);
    expect(text(root, 'one')).toEqual(['none']);
    emit('prices', '9', 'b');
    emit('prices', '4', 'a');
    await settle();
    expect(text(root, 'one')).toEqual(['4']);
  });

  it('the null key reads the records with no key', async () => {
    const { root, emit, watches } = mount(() => <One k={null} />);
    await settle();
    expect(watches()).toEqual([{ topic: 'prices', keys: [null] }]);
    emit('prices', '7');
    emit('prices', '8', 'a');
    await settle();
    expect(text(root, 'one')).toEqual(['7']);
  });

  it('a reset empties the view', async () => {
    const { root, emit, reset } = mount(() => (
      <div>
        <All />
        <One k="a" />
      </div>
    ));
    await settle();
    emit('prices', '5', 'a');
    await settle();
    expect(text(root, 'all')).toEqual(['a=5']);
    reset('prices');
    await settle();
    expect(text(root, 'all')).toEqual(['']);
    expect(text(root, 'one')).toEqual(['none']);
  });

  it('a view settles once its render has committed', async () => {
    const { emit, settles } = mount(() => <One k="a" />);
    await settle();
    emit('prices', '1', 'a');
    await settle();
    expect(settles.length).toBeGreaterThan(0);
    expect(settles.every((s) => s.settled)).toBe(true);
  });

  it('a render that never commits ends its watch, so no `seen` goes', async () => {
    // Preact unmounts a tree that suspends after mounting, where React keeps
    // it: the watch ends with it, and the runtime confirms no view of a watch
    // that's gone.
    const { root, emit, watches } = mount(() => (
      <Suspense fallback={<p class="fallback">wait</p>}>
        <Suspends />
      </Suspense>
    ));
    await settle();
    emit('prices', '1', 'a');
    await settle();
    expect(text(root, 's')).toEqual(['1']);
    expect(watches()).toHaveLength(1);
    emit('prices', 'stall', 'a');
    await settle();
    expect(text(root, 'fallback')).toEqual(['wait']);
    expect(watches()).toEqual([]);
  });
});
