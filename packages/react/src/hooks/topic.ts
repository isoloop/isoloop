/*
 * Bus hooks (design §5): `useTopic` reads a topic through
 * `useSyncExternalStore`, so concurrent renders never tear; `usePublish`
 * returns a publish function.
 */
import type { StartPosition, TopicRef } from '@isoloop/protocol';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useIsolate } from '../isolate/context';

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
 * An isolate has one subscription per topic. A second `useTopic` on the same topic, in
 * another component or another call in the same one, replaces the first with no error: only
 * the last one subscribed gets records, and the first stops updating. When the last one
 * unmounts, the topic has no subscription, and the first doesn't get it back. Call
 * `useTopic` once per topic, and pass the value down as props or share it through context.
 * With the kernel's `dev: true`, the bus warns in the console when this happens.
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
  const store = useMemo(() => {
    let latest: { v: Out } | undefined;
    return {
      subscribe: (notify: () => void): (() => void) =>
        bus.subscribe(
          topic,
          (r) => {
            latest = { v: r.value };
            notify();
          },
          {
            from,
            onReset: () => {
              latest = undefined;
              notify();
            },
          },
        ),
      get: () => latest,
    };
  }, [bus, topic.name, from]);
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
    (value: In, o: { key?: string } = {}) =>
      bus.publish(topic, o.key === undefined ? { value } : { key: o.key, value }),
    [bus, topic.name],
  );
}
