/*
 * The isolate's context for components: what `start(ctx)` received, provided
 * by `defineIsolate` at the root, so hooks reach the bus and host calls.
 */
import type { IsolateContext } from '@isoloop/runtime';
import { createContext, useContext, type Context } from 'react';

export const IsolateCtx: Context<IsolateContext | null> = createContext<IsolateContext | null>(
  null,
);

/** The isolate context. Throws outside a component that `defineIsolate` rendered. */
export function useIsolate(): IsolateContext {
  const ctx = useContext(IsolateCtx);
  if (!ctx) throw new Error('useIsolate: not inside a component rendered by defineIsolate()');
  return ctx;
}
