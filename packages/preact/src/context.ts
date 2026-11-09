/*
 * The isolate's context for components: what `start(ctx)` received, provided
 * by `defineIsolate` at the root, so hooks reach the bus and host calls.
 */
import type { IsolateContext } from '@isoloop/runtime';
import { createContext, type Context } from 'preact';
import { useContext } from 'preact/hooks';

export const IsolateCtx: Context<IsolateContext | null> = createContext<IsolateContext | null>(
  null,
);

/** The isolate context. Throws outside a component that `defineIsolate` rendered. */
export function useIsolate(): IsolateContext {
  const ctx = useContext(IsolateCtx);
  if (!ctx) throw new Error('useIsolate: not inside a component rendered by defineIsolate()');
  return ctx;
}

/**
 * `ctx.portalRoot`: the container inside this isolate's surface for modals,
 * tooltips, toasts and menus (ADR 0015), for `createPortal` or a library's
 * container option. Throws in a headless isolate.
 */
export function usePortalRoot(): Element {
  const portal: unknown = useIsolate().portalRoot;
  if (!(portal instanceof Element)) throw new Error('usePortalRoot: this isolate has no surface');
  return portal;
}
