/*
 * `useRoute` (ADR 0002): the host's current location. The route topic is
 * subscribed only while a component uses this hook, so an isolate that never
 * asks for the route never reads it.
 */
import { routeTopic, type RouteValue } from '@isoloop/protocol';
import { useTopic } from './topic';

/** The current route, or `undefined` until the first record arrives (or with routing off). */
export function useRoute(): RouteValue | undefined {
  return useTopic(routeTopic, { from: 'earliest' });
}
