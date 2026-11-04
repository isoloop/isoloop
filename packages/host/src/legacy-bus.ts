/*
 * The proof of concept's main-thread pub/sub, for M0 only (the bus worker
 * replaces it in M2). A publish goes to every subscriber of the topic except
 * the publisher, as in the PoC.
 */

export type BusDelivery = { from: string; topic: string; value: unknown; targets: string[] };

export interface LegacyBus {
  subscribe(id: string, topic: string): void;
  /** Returns the ids the record went to. */
  publish(from: string, topic: string, value: unknown): string[];
  /** Drops all of an isolate's subscriptions (stop, crash, restart). */
  remove(id: string): void;
}

export function createLegacyBus(deliver: (to: string, d: BusDelivery) => void): LegacyBus {
  const subs = new Map<string, Set<string>>();
  return {
    subscribe(id, topic) {
      let set = subs.get(topic);
      if (!set) subs.set(topic, (set = new Set()));
      set.add(id);
    },
    publish(from, topic, value) {
      const targets = [...(subs.get(topic) ?? [])].filter((id) => id !== from);
      const d = { from, topic, value, targets };
      for (const to of targets) deliver(to, d);
      return targets;
    },
    remove(id) {
      for (const set of subs.values()) set.delete(id);
    },
  };
}
