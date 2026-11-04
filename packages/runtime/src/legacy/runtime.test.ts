import type { IsolateToHost, LegacyIsolateToHost } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { createLegacyIsolate } from './runtime';

type Msg = IsolateToHost | LegacyIsolateToHost;

const setup = () => {
  const sent: Msg[] = [];
  const rt = createLegacyIsolate<{ n: number }>({
    id: 'A',
    config: null,
    initial: { n: 0 },
    post: (m) => sent.push(m),
  });
  return { rt, iso: rt.iso, sent };
};

const event = (value?: string) => ({
  v: 1,
  t: 'event',
  p: {
    type: 'input',
    target: 'type',
    currentTargets: ['type'],
    mods: { alt: false, ctrl: false, meta: false, shift: false },
    ...(value === undefined ? {} : { value }),
  },
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createLegacyIsolate', () => {
  it('coalesces renders to one patch per task', async () => {
    const { iso, sent } = setup();
    iso.view((s) => iso.h('b', null, s.n));
    iso.setState({ n: 1 });
    iso.setState((s) => ({ n: s.n + 1 }));
    await tick();
    expect(sent).toEqual([
      { v: 1, t: 'patch', p: { fmt: 'legacy-vdom@1', batch: { t: 'b', p: {}, c: ['2'] } } },
    ]);
  });

  it('does not render before view() is set', async () => {
    const { iso, sent } = setup();
    iso.setState({ n: 1 });
    await tick();
    expect(sent).toEqual([]);
  });

  it('calls the handler an event targets, with its value', () => {
    const { rt, iso } = setup();
    const got: (string | null)[] = [];
    iso.on('type', (v) => got.push(v));
    rt.receive(event('hi'));
    rt.receive(event());
    expect(got).toEqual(['hi', null]);
  });

  it('posts x-sub and x-pub, and delivers x-deliver to subscribers', () => {
    const { rt, iso, sent } = setup();
    const got: unknown[] = [];
    iso.bus.subscribe('note', (value, from) => got.push([from, value]));
    iso.bus.publish('count', 3);
    rt.receive({ v: 1, t: 'x-deliver', p: { topic: 'note', value: 'hi', from: 'D' } });
    rt.receive({ v: 1, t: 'x-deliver', p: { topic: 'other', value: 1, from: 'D' } });
    expect(sent).toEqual([
      { v: 1, t: 'x-sub', p: { topic: 'note' } },
      { v: 1, t: 'x-pub', p: { topic: 'count', value: 3 } },
    ]);
    expect(got).toEqual([['D', 'hi']]);
  });

  it('drops and counts unknown messages', () => {
    const { rt } = setup();
    rt.receive({ v: 1, t: 'nope', p: {} });
    rt.receive({ v: 2, t: 'event', p: {} });
    rt.receive('junk');
    expect(rt.dropped).toBe(3);
  });
});
