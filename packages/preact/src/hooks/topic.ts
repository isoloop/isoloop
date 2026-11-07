/*
 * Bus hooks (design §5): `useTopic` subscribes for the component's lifetime
 * and keeps the latest value; `usePublish` returns a publish function.
 */
import type { StartPosition, TopicRef } from '@isoloop/protocol';
import { useCallback, useLayoutEffect, useState } from 'preact/hooks';
import { useIsolate } from '../context';

export type UseTopicOptions = {
  /** Default `latest`. `earliest` replays the topic, so a compacted one gives its current value at once. */
  from?: StartPosition;
};

/**
 * The latest value on `topic`, or `undefined` until one arrives. A bus
 * restart that lost the memory topic (`onReset`, ADR 0007) clears it.
 * Subscribes on mount and unsubscribes on unmount; changing `topic` or
 * `from` resubscribes.
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
