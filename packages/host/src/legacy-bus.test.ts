import { describe, expect, it } from 'vitest';
import { createLegacyBus, type BusDelivery } from './legacy-bus';

const setup = () => {
  const got: [string, BusDelivery][] = [];
  const bus = createLegacyBus((to, d) => got.push([to, d]));
  return { bus, got };
};

describe('legacy bus', () => {
  it('delivers to every subscriber but the publisher', () => {
    const { bus, got } = setup();
    bus.subscribe('A', 'count');
    bus.subscribe('C', 'count');
    bus.subscribe('D', 'count');
    expect(bus.publish('A', 'count', 1)).toEqual(['C', 'D']);
    expect(got.map(([to]) => to)).toEqual(['C', 'D']);
    expect(got[0]?.[1]).toEqual({ from: 'A', topic: 'count', value: 1, targets: ['C', 'D'] });
  });

  it('delivers nothing without subscribers', () => {
    const { bus, got } = setup();
    expect(bus.publish('A', 'note', 'hi')).toEqual([]);
    expect(got).toEqual([]);
  });

  it('subscribing twice delivers once', () => {
    const { bus } = setup();
    bus.subscribe('C', 'count');
    bus.subscribe('C', 'count');
    expect(bus.publish('A', 'count', 1)).toEqual(['C']);
  });

  it('remove drops all of an isolate’s subscriptions', () => {
    const { bus } = setup();
    bus.subscribe('C', 'count');
    bus.subscribe('C', 'note');
    bus.remove('C');
    expect(bus.publish('A', 'count', 1)).toEqual([]);
    expect(bus.publish('A', 'note', 1)).toEqual([]);
  });
});
