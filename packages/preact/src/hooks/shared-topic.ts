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
  /** `from` values already warned about, so each warns once. */
  warned: Set<StartPosition>;
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
 * subscription and gets a console warning. Returns the function that removes
 * the reader; the last one out unsubscribes.
 */
export function addReader<Out>(
  bus: BusClient,
  topic: TopicRef<any, Out, any, any>,
  from: StartPosition,
  notify: () => void,
): () => void {
  let topics = byBus.get(bus);
  if (!topics) {
    topics = new Map();
    byBus.set(bus, topics);
  }
  let entry = topics.get(topic.name);
  if (!entry) {
    const e: Entry = {
      from,
      latest: undefined,
      readers: new Set(),
      unsubscribe: () => {},
      warned: new Set(),
    };
    const tell = () => {
      for (const r of e.readers) r.notify();
    };
    e.unsubscribe = bus.subscribe(
      topic,
      (r) => {
        e.latest = { v: r.value };
        tell();
      },
      {
        from,
        onReset: () => {
          e.latest = undefined;
          tell();
        },
      },
    );
    topics.set(topic.name, e);
    entry = e;
  } else if (from !== entry.from && !entry.warned.has(from)) {
    entry.warned.add(from);
    console.warn(
      `[isoloop] useTopic("${topic.name}", { from: '${from}' }) shares the subscription an earlier useTopic opened with from: '${entry.from}'; it gets that subscription's latest value.`,
    );
  }
  const e = entry;
  const reader = { notify };
  e.readers.add(reader);
  return () => {
    if (!e.readers.delete(reader) || e.readers.size > 0) return;
    e.unsubscribe();
    if (topics.get(topic.name) === e) topics.delete(topic.name);
  };
}
