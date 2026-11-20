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

/**
 * The isolate's context, as `start(ctx)` gets it: `ctx.bus`, `ctx.host`, `ctx.config` and
 * the rest.
 *
 * @returns The context of the isolate this component runs in.
 * @throws `Error` outside a component that `defineIsolate` rendered.
 */
export function useIsolate(): IsolateContext {
  const ctx = useContext(IsolateCtx);
  if (!ctx) throw new Error('useIsolate: not inside a component rendered by defineIsolate()');
  return ctx;
}

/**
 * The container inside this isolate's surface for modals, tooltips, toasts and menus
 * (`ctx.portalRoot`), for `createPortal` or a library's container option. Content
 * portalled there stays inside the isolate's surface.
 *
 * @returns The portal container.
 * @throws `Error` in a headless isolate, or outside a component that `defineIsolate` rendered.
 */
export function usePortalRoot(): Element {
  const portal: unknown = useIsolate().portalRoot;
  if (!(portal instanceof Element)) throw new Error('usePortalRoot: this isolate has no surface');
  return portal;
}
