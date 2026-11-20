/** What an isolate may do on the bus and the host: `IsolateManifest.grants`. */
export type Grants = {
  /** Topic patterns the isolate may publish to. `*` matches one or more characters, dots included. */
  publish: string[];
  /** Topic patterns the isolate may subscribe to, the same way. */
  subscribe: string[];
  /** `ctx.host.navigate()` allowed. Default false. */
  navigate?: boolean;
  /**
   * The inspection feed and its controls: the isolate gets `ctx.inspector` on a port of its own, which reads the feed and can
   * restart, kill and block isolates. Default false. Never in a pool: spawning
   * a pooled isolate with it fails with `invalid_config`, since a pool merges
   * its members' grants.
   * @experimental
   */
  inspect?: boolean;
};

/** Topics under this prefix belong to the kernel (ADR 0002). */
export const SYSTEM_TOPIC_PREFIX = 'isoloop.';

export function isSystemTopic(topic: string): boolean {
  return topic.startsWith(SYSTEM_TOPIC_PREFIX);
}

const escape = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

const compiled = new Map<string, RegExp>();

/**
 * True if `topic` matches the grant pattern. `*` matches one or more
 * characters, dots included, so `catalog.*` covers `catalog.items.v1` and
 * `cart.*.v1` covers `cart.items.v1`. Without `*` the match is exact.
 */
export function matchTopic(grant: string, topic: string): boolean {
  if (!grant.includes('*')) return grant === topic;
  let re = compiled.get(grant);
  if (!re) {
    re = new RegExp(`^${grant.split('*').map(escape).join('.+')}$`);
    compiled.set(grant, re);
  }
  return re.test(topic);
}

/** True if any pattern in the list matches `topic`. */
export function matchAny(patterns: readonly string[], topic: string): boolean {
  return patterns.some((p) => matchTopic(p, topic));
}
