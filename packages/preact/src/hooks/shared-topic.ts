/*
 * One bus subscription per (isolate, topic), shared by every `useTopic` on it
 * (#410). The bus keeps one subscription per topic per isolate and replaces
 * the older one on a second subscribe, so the hooks count their readers here
 * instead: the first reader subscribes, the last one to leave unsubscribes,
 * and every reader sees the same latest value. M8 Watchers' `useWatch` builds
 * on it. The same file is in the React adapter.
 */
import type { BusClient } from '@isoloop/runtime';
import type { StartPosition, TopicRef } from '@isoloop/protocol';

/** The latest value, boxed so `undefined` can be a value. */
export type Latest<Out> = { v: Out } | undefined;

type Entry = {
  from: StartPosition;
  latest: Latest<unknown>;
  /** One token per reader, so the same callback added twice counts twice. */
  readers: Set<{ notify: () => void }>;
  unsubscribe: () => void;
  /** Whether a reader with another `from` has been warned about. */
  warned?: true;
};

const byBus = new WeakMap<BusClient, Map<string, Entry>>();

/** `topic`'s latest value in `bus`'s shared subscription, or `undefined` with no readers yet. */
export function latest<Out>(bus: BusClient, topic: TopicRef<any, Out, any, any>): Latest<Out> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the entry holds this topic's records
  return byBus.get(bus)?.get(topic.name)?.latest as Latest<Out>;
}

/**
 * Adds a reader of `topic`, called after every new value or reset. The first
 * reader subscribes from `from`; a later one with another `from` shares that
 * subscription, and the first such reader gets a console warning. Returns the
 * function that removes the reader; the last one out unsubscribes.
 */
export function addReader<Out>(
  bus: BusClient,
  topic: TopicRef<any, Out, any, any>,
  from: StartPosition,
  notify: () => void,
): () => void {
  const topics = byBus.get(bus) ?? new Map<string, Entry>();
  byBus.set(bus, topics);
  let e = topics.get(topic.name);
  if (!e) {
    const entry: Entry = { from, latest: undefined, readers: new Set(), unsubscribe: () => {} };
    const set = (v: Latest<unknown>) => {
      entry.latest = v;
      for (const r of entry.readers) r.notify();
    };
    entry.unsubscribe = bus.subscribe(topic, (r) => set({ v: r.value }), {
      from,
      onReset: () => set(undefined),
    });
    topics.set(topic.name, (e = entry));
  } else if (from !== e.from && !e.warned) {
    e.warned = true;
    console.warn(`[isoloop] useTopic("${topic.name}"): from '${from}' shares from '${e.from}'`);
  }
  const shared = e;
  const reader = { notify };
  shared.readers.add(reader);
  return () => {
    if (!shared.readers.delete(reader) || shared.readers.size > 0) return;
    shared.unsubscribe();
    if (topics.get(topic.name) === shared) topics.delete(topic.name);
  };
}
