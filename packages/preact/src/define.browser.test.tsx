import type { TopicRef } from '@isoloop/protocol';
import { createTestContext } from '@isoloop/runtime/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createPortal } from 'preact/compat';
import { defineIsolate, usePortalRoot, usePublish, useTopic } from './index';

// M3a task 7: rendering and topics, on the project's Preact major. The
// context is a test double; the real worker path is the adapter E2E suite.

const ref = <T,>(name: string): TopicRef<T> => ({ name, schema: { '~standard': {} } });
const prices = ref<number>('prices');
const orders = ref<string>('orders');

const roots: HTMLElement[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) r.remove();
});

function mount(Component: Parameters<typeof defineIsolate>[0], config: unknown = null) {
  const root = document.createElement('div');
  document.body.append(root);
  roots.push(root);
  const t = createTestContext({ root, config });
  void defineIsolate(Component).start(t.ctx);
  return { ...t, root };
}

// Preact runs effects after paint, and renders state updates on its own schedule.
const settle = () => new Promise((r) => setTimeout(r, 30));

function Price() {
  const price = useTopic(prices, { from: 'earliest' });
  return <p>{price === undefined ? 'none' : `price ${price}`}</p>;
}

describe('Preact adapter: rendering and topics', () => {
  it('renders the component into ctx.root, with manifest.config as a prop', () => {
    const { root } = mount(({ config }) => <h1>{String(config)}</h1>, 'hello');
    expect(root.innerHTML).toBe('<h1>hello</h1>');
  });

  it('a published record re-renders; a reset clears the value', async () => {
    const { root, emit, reset, subscriptions } = mount(Price);
    await settle();
    expect(root.textContent).toBe('none');
    expect(subscriptions()).toEqual([{ topic: 'prices', from: 'earliest' }]);
    emit('prices', 42);
    await settle();
    expect(root.textContent).toBe('price 42');
    emit('prices', 43);
    await settle();
    expect(root.textContent).toBe('price 43');
    reset('prices');
    await settle();
    expect(root.textContent).toBe('none');
  });

  it('usePublish returns the bus publish promise', async () => {
    let send: ((v: string) => Promise<void>) | undefined;
    function Order() {
      const publish = usePublish(orders);
      send = (v) => publish(v, { key: 'k' });
      return null;
    }
    const { published } = mount(Order);
    await settle();
    await expect(send?.('buy')).resolves.toBeUndefined();
    expect(published).toEqual([{ topic: 'orders', key: 'k', value: 'buy' }]);
  });

  it('shutdown unmounts the tree and unsubscribes', async () => {
    const { root, shutdown, subscriptions } = mount(Price);
    await settle();
    expect(subscriptions()).toHaveLength(1);
    await shutdown();
    expect(root.innerHTML).toBe('');
    expect(subscriptions()).toEqual([]);
  });

  it('refuses a headless context', () => {
    const { ctx } = createTestContext({ id: 'H' });
    expect(() => defineIsolate(() => null).start(ctx)).toThrow(/"H" is headless/);
  });
});

const Boom = (): never => {
  throw new Error('boom');
};

function Modal() {
  return createPortal(<dialog open>hi</dialog>, usePortalRoot());
}

describe('Preact adapter: per-isolate boundary and portal root (M2d task 3, ADR 0015)', () => {
  it("reports a render error as the isolate's own and renders nothing in its place", async () => {
    const { root, errors } = mount(Boom);
    await settle();
    expect(errors.map((e) => [String(e.error), e.fatal])).toEqual([['Error: boom', true]]);
    expect(root.innerHTML).toBe('');
  });

  it('renders a portal into ctx.portalRoot, inside the root', async () => {
    const { root } = mount(() => (
      <>
        <p>app</p>
        <Modal />
      </>
    ));
    await settle();
    expect(root.innerHTML).toBe(
      '<p>app</p><div data-isoloop-portal=""><dialog open="">hi</dialog></div>',
    );
  });
});
