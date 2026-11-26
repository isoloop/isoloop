import type { TopicRef } from '@isoloop/protocol';
import { createTestContext } from '@isoloop/runtime/testing';
import { StrictMode, useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineIsolate, useTopic } from '../index';

// #410: every useTopic on a topic in one isolate shares one bus subscription.

const prices: TopicRef<number> = { name: 'prices', schema: { '~standard': {} } };

const roots: HTMLElement[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) r.remove();
  vi.restoreAllMocks();
});

function mount(Component: () => JSX.Element) {
  const root = document.createElement('div');
  document.body.append(root);
  roots.push(root);
  const t = createTestContext({ root });
  void defineIsolate(Component).start(t.ctx);
  return { ...t, root };
}

const settle = () => new Promise((r) => setTimeout(r, 30));
const text = (root: HTMLElement, cls: string) =>
  [...root.querySelectorAll(`.${cls}`)].map((e) => e.textContent);

function Reader({ cls, from }: { cls: string; from?: 'earliest' | 'latest' }) {
  const v = useTopic(prices, from === undefined ? {} : { from });
  return <p className={cls}>{v === undefined ? 'none' : String(v)}</p>;
}

let show: ((n: number) => void) | undefined;
function Readers({ initial = 2 }: { initial?: number }) {
  const [n, setN] = useState(initial);
  show = setN;
  return (
    <div>
      {Array.from({ length: n }, (_, i) => (
        <Reader key={i} cls="r" />
      ))}
    </div>
  );
}

describe('React adapter: useTopic on one topic from several components (#410)', () => {
  it('two components on one topic both update, through one subscription', async () => {
    const { root, emit, subscriptions } = mount(() => <Readers />);
    await settle();
    expect(subscriptions()).toEqual([{ topic: 'prices', from: 'latest' }]);
    emit('prices', 5);
    await settle();
    expect(text(root, 'r')).toEqual(['5', '5']);
  });

  it('unmounting one leaves the other updating; the last one out unsubscribes', async () => {
    const { root, emit, subscriptions } = mount(() => <Readers />);
    await settle();
    show?.(1);
    await settle();
    expect(subscriptions()).toHaveLength(1);
    emit('prices', 8);
    await settle();
    expect(text(root, 'r')).toEqual(['8']);
    show?.(0);
    await settle();
    expect(subscriptions()).toEqual([]);
  });

  it('one that mounts later gets the current value at once', async () => {
    const { root, emit, subscriptions } = mount(() => <Readers initial={1} />);
    await settle();
    emit('prices', 3);
    await settle();
    show?.(2);
    await settle();
    expect(text(root, 'r')).toEqual(['3', '3']);
    expect(subscriptions()).toHaveLength(1);
  });

  it('a reset clears every reader', async () => {
    const { root, emit, reset } = mount(() => <Readers />);
    await settle();
    emit('prices', 4);
    await settle();
    reset('prices');
    await settle();
    expect(text(root, 'r')).toEqual(['none', 'none']);
  });

  it("the first one's from wins; a later different from shares it and warns once", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root, emit, subscriptions } = mount(() => (
      <div>
        <Reader cls="a" from="earliest" />
        <Reader cls="b" from="latest" />
        <Reader cls="c" from="latest" />
      </div>
    ));
    await settle();
    expect(subscriptions()).toEqual([{ topic: 'prices', from: 'earliest' }]);
    emit('prices', 9);
    await settle();
    expect([...text(root, 'a'), ...text(root, 'b'), ...text(root, 'c')]).toEqual(['9', '9', '9']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("'earliest'");
  });

  it('StrictMode leaves one subscription for two components', async () => {
    const { root, emit, subscriptions, shutdown } = mount(() => (
      <StrictMode>
        <Readers />
      </StrictMode>
    ));
    await settle();
    expect(subscriptions()).toHaveLength(1);
    emit('prices', 7);
    await settle();
    expect(text(root, 'r')).toEqual(['7', '7']);
    await shutdown();
    expect(subscriptions()).toEqual([]);
  });

  it('isolates keep their own subscriptions', async () => {
    const a = mount(() => <Reader cls="r" />);
    const b = mount(() => <Reader cls="r" />);
    await settle();
    a.emit('prices', 1);
    b.emit('prices', 2);
    await settle();
    expect(text(a.root, 'r')).toEqual(['1']);
    expect(text(b.root, 'r')).toEqual(['2']);
  });
});
