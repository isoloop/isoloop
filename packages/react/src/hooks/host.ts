/*
 * `useHost` (design §4.7): the isolate's host calls. Pass the elements a ref
 * holds; they're the DOM subset's, and the host finds what it rendered for
 * them after pending patches apply.
 */
import type { HostApi } from '@isoloop/runtime';
import { useIsolate } from '../isolate/context';

/**
 * The isolate's host calls (`ctx.host`): `measure`, `focus`, `scrollIntoView` and
 * `navigate`. Pass them the elements a ref holds; the host acts on what it rendered for
 * them, after pending changes are applied.
 *
 * @returns The host API.
 * @throws `Error` outside a component that `defineIsolate` rendered.
 */
export function useHost(): HostApi {
  return useIsolate().host;
}
