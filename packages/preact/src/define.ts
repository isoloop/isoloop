/*
 * `defineIsolate(Component)` (ADR 0010): an isolate module's default export
 * that renders `Component` into `ctx.root` with Preact, under the isolate
 * context, and unmounts it on shutdown so effects clean up (unsubscribing,
 * among others).
 */
import { REQUIRES, type IsolateDefinition } from '@isoloop/runtime';
import { h, render, type ComponentType } from 'preact';
import { IsolateCtx } from './context';

/** Props every isolate component gets: `manifest.config`, passed through. */
export type IsolateProps = { config: unknown };

export function defineIsolate(Component: ComponentType<IsolateProps>): IsolateDefinition {
  return {
    // The version this isolate was built against (ADR 0012), as runtime's `defineIsolate` stamps it.
    requires: REQUIRES,
    start(ctx) {
      // In the worker, `Element` is the DOM subset's, which `ctx.root` is.
      const container: unknown = ctx.root;
      if (!(container instanceof Element)) {
        throw new Error(`defineIsolate (Preact): "${ctx.id}" is headless; Preact needs a surface`);
      }
      render(
        h(IsolateCtx.Provider, { value: ctx }, h(Component, { config: ctx.config })),
        container,
      );
      ctx.onShutdown(() => {
        render(null, container);
      });
    },
  };
}
