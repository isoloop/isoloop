// The shapes an isolate gets by its stamp (ADR 0012, *Changing a member by
// stamp*): in 0.2, an isolate built before 0.2 keeps 0.1's publish.
import type { TopicRef } from '@isoloop/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BusClient } from './bus-client';
import { applyStamp, OLD_PUBLISH_WARNING, usesOldPublish, withOldPublish } from './stamped';

/** A 0.1 isolate's topic: its calls pass `{ value, key? }`, which the 0.2 types don't describe. */
const topic: TopicRef<any, any, any, any> = { name: 'count.v1', schema: { '~standard': {} } };

/** A bus that records what `publish` got. */
function fakeBus() {
  const calls: unknown[][] = [];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in with the two members these tests call
  const bus = {
    publish: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    },
    subscribe: () => () => {},
  } as unknown as BusClient;
  return { bus, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usesOldPublish', () => {
  it('is true for an isolate built before 0.2 on a runtime from 0.2', () => {
    expect(usesOldPublish('0.1', '0.2')).toBe(true);
    expect(usesOldPublish('0.0', '0.2')).toBe(true);
  });

  it('is false for 0.2 and later isolates, unstamped ones and unreadable stamps', () => {
    expect(usesOldPublish('0.2', '0.2')).toBe(false);
    expect(usesOldPublish('0.3', '0.3')).toBe(false);
    expect(usesOldPublish(undefined, '0.2')).toBe(false);
    expect(usesOldPublish('next', '0.2')).toBe(false);
  });

  it('is false on a runtime older than 0.2, where the old shape is the only one', () => {
    expect(usesOldPublish('0.1', '0.1')).toBe(false);
  });
});

describe('withOldPublish', () => {
  it('reads 0.1 records: the value, and the key when set', async () => {
    const { bus, calls } = fakeBus();
    const old = withOldPublish(bus);
    await old.publish(topic, { value: 1 });
    await old.publish(topic, { value: 2, key: 'k' });
    expect(calls).toEqual([
      [topic, 1, {}],
      [topic, 2, { key: 'k' }],
    ]);
  });

  it('warns on the first call only', async () => {
    const { bus } = fakeBus();
    const warn = vi.fn();
    const old = withOldPublish(bus, warn);
    await old.publish(topic, { value: 1 });
    await old.publish(topic, { value: 2 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps the other members, and rejects a record that is not an object', async () => {
    const { bus } = fakeBus();
    const old = withOldPublish(bus);
    expect(Object.keys(old)).toEqual(Object.keys(bus));
    await expect(old.publish(topic, 1)).rejects.toThrow(TypeError);
  });
});

describe('applyStamp', () => {
  it('gives a 0.1 isolate the old publish, warning once in dev', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bus, calls } = fakeBus();
    const ctx = { bus };
    applyStamp(ctx, '0.1', true, '0.2');
    await ctx.bus.publish(topic, { value: 1, key: 'a' });
    await ctx.bus.publish(topic, { value: 2 });
    expect(calls).toEqual([
      [topic, 1, { key: 'a' }],
      [topic, 2, {}],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(OLD_PUBLISH_WARNING);
  });

  it('warns nothing outside dev', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = { bus: fakeBus().bus };
    applyStamp(ctx, '0.1', false, '0.2');
    await ctx.bus.publish(topic, { value: 1 });
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves the current publish to 0.2 and unstamped isolates', () => {
    for (const requires of ['0.2', undefined]) {
      const { bus } = fakeBus();
      const ctx = { bus };
      applyStamp(ctx, requires, true, '0.2');
      expect(ctx.bus).toBe(bus);
    }
  });
});
