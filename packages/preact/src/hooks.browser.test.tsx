import { BusError } from '@isoloop/protocol';
import type { TopicRef } from '@isoloop/protocol';
import { createTestContext, type TestContextOptions } from '@isoloop/runtime/testing';
import { useEffect, useRef, useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { defineIsolate, useHost, useRequest, useRoute } from './index';

// M3a task 8: requests, host calls and the route, on the project's Preact major.

const quote: TopicRef<string, string, never, number> = {
  name: 'quote',
  schema: { '~standard': {} },
  reply: { '~standard': {} },
};

const roots: HTMLElement[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) r.remove();
});

function mount(Component: () => preact.JSX.Element | null, o: TestContextOptions = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  roots.push(root);
  const t = createTestContext({ ...o, root });
  void defineIsolate(Component).start(t.ctx);
  return { ...t, root };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

function Quote({ timeoutMs }: { timeoutMs?: number }) {
  const ask = useRequest(quote);
  const [out, setOut] = useState('…');
  useEffect(() => {
    ask('AAPL', timeoutMs === undefined ? {} : { timeoutMs }).then(
      (n) => setOut(`price ${n}`),
      (e: unknown) => setOut(e instanceof BusError ? `error ${e.code}` : 'error'),
    );
  }, []);
  return <p>{out}</p>;
}

function Box() {
  const host = useHost();
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    void host.measure(ref.current).then((r) => setW(r.width));
  }, []);
  return <div ref={ref}>{w}</div>;
}

function Where() {
  const route = useRoute();
  return <p>{route?.path ?? 'unknown'}</p>;
}

describe('Preact adapter: requests, host calls, route', () => {
  it('a request resolves with the reply', async () => {
    const { root } = mount(() => <Quote />, {
      respond: (topic, value) => (topic === 'quote' && value === 'AAPL' ? 187 : 0),
    });
    await settle();
    expect(root.textContent).toBe('price 187');
  });

  it('a request with no reply times out', async () => {
    const { root } = mount(() => <Quote timeoutMs={20} />);
    await settle();
    await settle();
    expect(root.textContent).toBe('error timeout');
  });

  it('measure goes to the host with the element the ref holds', async () => {
    const asked: unknown[] = [];
    const { root } = mount(Box, {
      host: {
        measure: (node) => {
          asked.push(node);
          return Promise.resolve({ x: 0, y: 0, width: 120, height: 10 });
        },
      },
    });
    await settle();
    expect(root.textContent).toBe('120');
    expect(asked).toEqual([root.firstElementChild]);
  });

  it('useRoute subscribes to the route topic from earliest; without it there is no subscription', async () => {
    const plain = mount(() => <p>no route</p>);
    await settle();
    expect(plain.subscriptions()).toEqual([]);

    const { root, emit, subscriptions } = mount(Where);
    await settle();
    expect(subscriptions()).toEqual([{ topic: 'isoloop.route.v1', from: 'earliest' }]);
    emit('isoloop.route.v1', {
      href: 'http://x/a',
      pathname: '/a',
      path: '/a',
      search: '',
      hash: '',
      state: null,
    });
    await settle();
    expect(root.textContent).toBe('/a');
  });
});
