/*
 * Bus hooks (design §5): `useTopic` reads a topic through
 * `useSyncExternalStore`, so concurrent renders never tear; `usePublish`
 * returns a publish function.
 */
import type { StartPosition, TopicRef } from '@isoloop/protocol';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useIsolate } from '../context';

export type UseTopicOptions = {
  /** Default `latest`. `earliest` replays the topic, so a compacted one gives its current value at once. */
  from?: StartPosition;
};

/**
 * The latest value on `topic`, or `undefined` until one arrives. A bus
 * restart that lost the memory topic (`onReset`, ADR 0007) clears it. The
 * bus subscription lives while the component is subscribed to the store:
 * StrictMode's extra subscribe and unsubscribe leave one subscription.
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

/** A function that publishes to `topic`; it resolves once the broker appended the record (`BusClient.publish`). */
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
