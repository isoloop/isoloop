/*
 * `useWatch` (ADR 0023): the current value per key of a topic, read through
 * `useSyncExternalStore` from one shared watch per topic and key
 * (`./shared-topic`). A view's `seen` waits until the render showing it has
 * committed, in a layout effect (point 21).
 */
import type { TopicRef } from '@isoloop/protocol';
import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useIsolate } from '../isolate/context';
import {
  addWatchReader,
  commitWatch,
  watchSnapshot,
  type WatchReader,
  type WatchSpec,
} from './shared-topic';

/** Options for {@link useWatch}: the one key to read. @experimental */
export type UseWatchOptions = {
  /** The key to read; `null` reads the records with no key. */
  key: string | null;
};

const EMPTY: ReadonlyMap<string | null, unknown> = new Map<string | null, unknown>();

/**
 * A watcher skips values; use `useTopic` or `subscribe` to get every record.
 *
 * The current value per key of `topic`, as a map from key to value. Records with no key
 * share the key `null`. It starts with the newest retained value of each key, then follows
 * the keys that change; when several values arrive for a key between two renders, only the
 * newest is shown. A key leaves the map when retention removes its newest record. Treat the
 * map and its values as read-only.
 *
 * Any number of components can watch the same topic, and one that mounts later shows the
 * current map at once. The bus sends the next view only once the render showing this one
 * has committed, so a component never gets values faster than it draws them. StrictMode's
 * extra mount leaves one watch.
 *
 * @param topic - The topic to watch. The isolate needs a subscribe grant for it.
 * @returns The current value per key: empty until the first view arrives. A bus restart
 *   that lost a memory topic empties it.
 * @throws `Error` outside a component that `defineIsolate` rendered.
 * @experimental
 */
export function useWatch<Out>(topic: TopicRef<any, Out, any, any>): ReadonlyMap<string | null, Out>;
/**
 * A watcher skips values; use `useTopic` or `subscribe` to get every record.
 *
 * The current value of one key of `topic`. It starts with the newest retained value of the
 * key, then follows it; when several values arrive between two renders, only the newest is
 * shown. Treat the value as read-only.
 *
 * @param topic - The topic to watch. The isolate needs a subscribe grant for it.
 * @param opts - The key to read ({@link UseWatchOptions}); `{ key: null }` reads the records
 *   with no key.
 * @returns The key's current value, or `undefined` while it has none: before the first view,
 *   after retention removed its newest record, or after a bus restart lost a memory topic.
 * @throws `Error` outside a component that `defineIsolate` rendered.
 * @experimental
 */
export function useWatch<Out>(
  topic: TopicRef<any, Out, any, any>,
  opts: UseWatchOptions,
): Out | undefined;
export function useWatch<Out>(
  topic: TopicRef<any, Out, any, any>,
  opts?: UseWatchOptions,
): ReadonlyMap<string | null, Out> | Out | undefined {
  const { bus } = useIsolate();
  const keyed = opts !== undefined;
  const key = opts?.key ?? null;
  const store = useMemo(() => {
    const spec: WatchSpec = keyed ? { key } : undefined;
    const reader: WatchReader = { notify: () => {}, committed: 0 };
    return {
      spec,
      reader,
      subscribe: (notify: () => void): (() => void) => {
        reader.notify = notify;
        return addWatchReader(bus, topic, spec, reader);
      },
      get: () => watchSnapshot(bus, topic, spec),
    };
  }, [bus, topic.name, keyed, key]);
  const snap = useSyncExternalStore(store.subscribe, store.get);
  // After the commit that shows this view: its `seen` may go.
  useLayoutEffect(() => {
    commitWatch(bus, topic, store.spec, store.reader, snap?.gen ?? 0);
  }, [store, snap]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the watch holds this topic's values
  const view = (snap?.view ?? EMPTY) as ReadonlyMap<string | null, Out>;
  return keyed ? view.get(key) : view;
}
