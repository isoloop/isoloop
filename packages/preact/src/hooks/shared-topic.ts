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

/*
 * One `bus.watch` per (isolate, topic, key), shared by every `useWatch` that
 * reads it (ADR 0023, points 8 and 21). The entry keeps the current view, so
 * a component that mounts later renders it at once. A view counts as settled,
 * and its `seen` can go, once every reader has committed a render of it.
 */

/** A watch's view in the shared store; `gen` counts its views from 1. */
export type WatchSnap = { gen: number; view: ReadonlyMap<string | null, unknown> };

/** One component reading a watch: `committed` is the `gen` its last commit showed. */
export type WatchReader = { notify: () => void; committed: number };

/** `{ key }` reads one key, `null` for records with no key; `undefined` reads them all. */
export type WatchSpec = { key: string | null } | undefined;

type WatchEntry = {
  snap: WatchSnap | undefined;
  readers: Set<WatchReader>;
  /** The newest view not yet settled, and the promise `onView` returned for it. */
  pending: { gen: number; resolve: () => void } | undefined;
  unwatch: () => void;
};

const watchesByBus = new WeakMap<BusClient, Map<string, WatchEntry>>();

const entryName = (topic: string, spec: WatchSpec): string =>
  spec === undefined ? `${topic}\u0000*` : `${topic}\u0000${JSON.stringify(spec.key)}`;

function watchEntry(bus: BusClient, topic: string, spec: WatchSpec): WatchEntry | undefined {
  return watchesByBus.get(bus)?.get(entryName(topic, spec));
}

/** Resolves the pending view once every reader has committed it, or none is left. */
function settleIfCommitted(e: WatchEntry): void {
  const p = e.pending;
  if (!p) return;
  for (const r of e.readers) if (r.committed < p.gen) return;
  e.pending = undefined;
  p.resolve();
}

/** The current view of `topic` for `spec`, or `undefined` before the first one. */
export function watchSnapshot(
  bus: BusClient,
  topic: TopicRef<any, any, any, any>,
  spec: WatchSpec,
): WatchSnap | undefined {
  return watchEntry(bus, topic.name, spec)?.snap;
}

/**
 * Adds a reader of `topic` for `spec`, notified after every view. The first
 * reader watches; the last one out unwatches. Returns the function that
 * removes the reader.
 */
export function addWatchReader(
  bus: BusClient,
  topic: TopicRef<any, any, any, any>,
  spec: WatchSpec,
  reader: WatchReader,
): () => void {
  const entries = watchesByBus.get(bus) ?? new Map<string, WatchEntry>();
  watchesByBus.set(bus, entries);
  const name = entryName(topic.name, spec);
  let e = entries.get(name);
  if (!e) {
    const entry: WatchEntry = {
      snap: undefined,
      readers: new Set(),
      pending: undefined,
      unwatch: () => {},
    };
    entry.unwatch = bus.watch(
      topic,
      (view) => {
        // The runtime waits for this view to settle before the next one, so
        // nothing is pending here.
        entry.snap = { gen: (entry.snap?.gen ?? 0) + 1, view };
        const gen = entry.snap.gen;
        const settled = new Promise<void>((resolve) => {
          entry.pending = { gen, resolve };
        });
        for (const r of entry.readers) r.notify();
        settleIfCommitted(entry);
        return settled;
      },
      spec === undefined ? {} : { keys: [spec.key] },
    );
    entries.set(name, (e = entry));
  }
  const shared = e;
  shared.readers.add(reader);
  return () => {
    if (!shared.readers.delete(reader)) return;
    if (shared.readers.size > 0) {
      settleIfCommitted(shared);
      return;
    }
    shared.pending?.resolve();
    shared.pending = undefined;
    shared.unwatch();
    if (entries.get(name) === shared) entries.delete(name);
  };
}

/** A reader committed a render showing `gen`: the pending view may now be settled. */
export function commitWatch(
  bus: BusClient,
  topic: TopicRef<any, any, any, any>,
  spec: WatchSpec,
  reader: WatchReader,
  gen: number,
): void {
  reader.committed = Math.max(reader.committed, gen);
  const e = watchEntry(bus, topic.name, spec);
  if (e?.readers.has(reader)) settleIfCommitted(e);
}
