/*
 * Bus hooks (design §5): `useTopic` subscribes for the component's lifetime
 * and keeps the latest value; `usePublish` returns a publish function.
 */
import type { StartPosition, TopicRef } from '@isoloop/protocol';
import { useCallback, useLayoutEffect, useState } from 'preact/hooks';
import { useIsolate } from '../isolate/context';

/** Options for {@link useTopic}. */
export type UseTopicOptions = {
  /** Where reading starts. Default `'latest'`: only records appended from now. `'earliest'` replays the topic, so a compacted one gives its current value at once. */
  from?: StartPosition;
};

/**
 * The latest value on `topic`. It subscribes on mount and unsubscribes on unmount;
 * a different `topic` or `from` subscribes again.
 *
 * @param topic - The topic to read. The isolate needs a subscribe grant for it.
 * @param opts - Where reading starts ({@link UseTopicOptions}).
 * @returns The latest value, or `undefined` until one arrives. A bus restart that lost a
 *   memory topic clears it back to `undefined`.
 * @throws `Error` outside a component that `defineIsolate` rendered.
 */
export function useTopic<Out>(
  topic: TopicRef<any, Out, any, any>,
  opts: UseTopicOptions = {},
): Out | undefined {
  const { bus } = useIsolate();
  const [value, setValue] = useState<{ v: Out } | undefined>(undefined);
  const from = opts.from ?? 'latest';
  // A layout effect: it subscribes before paint, so no record is missed, and
  // Preact 11 runs its cleanup during unmount, where it defers passive ones
  // past paint, so shutdown has unsubscribed by the time it's done.
  useLayoutEffect(() => {
    setValue(undefined);
    return bus.subscribe(topic, (r) => setValue({ v: r.value }), {
      from,
      onReset: () => setValue(undefined),
    });
  }, [bus, topic.name, from]);
  return value?.v;
}

/**
 * A function that publishes to `topic`. The function is stable while `topic` is the same.
 *
 * @param topic - The topic to publish to. The isolate needs a publish grant for it.
 * @returns `(value, opts?) => Promise<void>`, with `opts.key` for the record's key. The
 *   promise resolves once the bus has appended the record, and rejects with a `BusError`:
 *   `forbidden` without a publish grant, `invalid` when the schema rejects the value
 *   (`issues` says why), `too_large` over the topic's `maxRecordBytes`, `not_encodable`
 *   for a value the bus can't store, `quota_exceeded` when storage is full,
 *   `unknown_topic`, or `bus_unavailable`.
 * @throws `Error` outside a component that `defineIsolate` rendered.
 */
export function usePublish<In>(
  topic: TopicRef<In, any, any, any>,
): (value: In, opts?: { key?: string }) => Promise<void> {
  const { bus } = useIsolate();
  return useCallback(
    (value: In, o: { key?: string } = {}) =>
      bus.publish(topic, o.key === undefined ? { value } : { key: o.key, value }),
    [bus, topic.name],
  );
}
