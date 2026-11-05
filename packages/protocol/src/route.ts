import {
  checks,
  systemSchema,
  systemTopic,
  type Check,
  type SystemTopicDef,
} from './system-topics';

/** The current location, as the kernel publishes it (ADR 0002). */
export type RouteValue = {
  /** Absolute URL. */
  href: string;
  pathname: string;
  /** `pathname` relative to `basePath`, starting with `/`; `null` outside it. */
  path: string | null;
  search: string;
  hash: string;
  /** `history.state` as is; `null` when it was too large for the bus (`route:state_dropped`). */
  state: unknown;
};

const stringOrNull: Check = (v, path) =>
  v === null || typeof v === 'string' ? [] : [{ message: 'expected a string or null', path }];

/**
 * `isoloop.route.v1`: compacted, key `"current"`, memory only (the URL is the
 * source of truth). Only the kernel publishes it; every isolate may
 * subscribe without a grant, with `from: 'earliest'` to get the current
 * route at once.
 */
export const routeTopic: SystemTopicDef<RouteValue> = systemTopic<RouteValue>('isoloop.route.v1', {
  schema: systemSchema(
    checks.object({
      href: checks.string,
      pathname: checks.string,
      path: stringOrNull,
      search: checks.string,
      hash: checks.string,
      state: checks.any,
    }),
  ),
  retention: { kind: 'compacted' },
});

/** The key of the one record that matters on `isoloop.route.v1`. */
export const ROUTE_KEY = 'current';

/** Every system topic, built into the bus. */
export const SYSTEM_TOPICS: readonly SystemTopicDef<any>[] = [routeTopic];
