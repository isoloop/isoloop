/*
 * Bus hooks (design §5): `useTopic` reads a topic through
 * `useSyncExternalStore`, so concurrent renders never tear, and shares one
 * subscription per topic (`./shared-topic`); `usePublish` returns a publish
 * function.
 */
import type { StartPosition, TopicRef } from '@isoloop/protocol';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useIsolate } from '../isolate/context';
import { addReader, latest } from './shared-topic';

/** Options for {@link useTopic}. */
export type UseTopicOptions = {
  /** Where reading starts. Default `'latest'`: only records appended from now. `'earliest'` replays the topic, so a compacted one gives its current value at once. */
  from?: StartPosition;
};

/**
 * The latest value on `topic`, read through `useSyncExternalStore`, so concurrent renders
 * never tear. The subscription lives while the component is mounted; StrictMode's extra
 * subscribe and unsubscribe leave one.
 *
 * Any number of components can read the same topic. Every `useTopic` on a topic in one
 * isolate shares one bus subscription: the first to mount subscribes, the last to unmount
 * unsubscribes, and each gets the same latest value, so one that mounts later sees the
 * current value at once. The first one's `from` sets where the shared subscription starts; a
 * later `useTopic` with a different `from` gets the shared value and a console warning.
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
  const from = opts.from ?? 'latest';
  const store = useMemo(
    () => ({
      subscribe: (notify: () => void): (() => void) => addReader(bus, topic, from, notify),
      get: () => latest(bus, topic),
    }),
    [bus, topic.name, from],
  );
  return useSyncExternalStore(store.subscribe, store.get)?.v;
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
    (value: In, o: { key?: string } = {}) => bus.publish(topic, value, o),
    [bus, topic.name],
  );
}
