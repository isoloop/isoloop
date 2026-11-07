/*
 * `useHost` (design §4.7): the isolate's host calls. Pass the elements a ref
 * holds; they're the DOM subset's, and the host finds what it rendered for
 * them after pending patches apply.
 */
import type { HostApi } from '@isoloop/runtime';
import { useIsolate } from '../context';

/** `measure`, `focus`, `scrollIntoView` and `navigate`, as `ctx.host` has them. */
export function useHost(): HostApi {
  return useIsolate().host;
}
