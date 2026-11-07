/*
 * `defineIsolate(Component)` (ADR 0010): an isolate module's default export
 * that renders `Component` into `ctx.root` with `createRoot`, under the
 * isolate context, and unmounts it on shutdown so effects clean up
 * (unsubscribing, among others).
 */
import type { IsolateDefinition } from '@isoloop/runtime';
import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { IsolateCtx } from './context';

/** Props every isolate component gets: `manifest.config`, passed through. */
export type IsolateProps = { config: unknown };

export function defineIsolate(Component: ComponentType<IsolateProps>): IsolateDefinition {
  return {
    start(ctx) {
      // In the worker, `Element` is the DOM subset's, which `ctx.root` is.
      const container: unknown = ctx.root;
      if (!(container instanceof Element)) {
        throw new Error(`defineIsolate (React): "${ctx.id}" is headless; React needs a surface`);
      }
      const root = createRoot(container);
      root.render(
        createElement(
          IsolateCtx.Provider,
          { value: ctx },
          createElement(Component, { config: ctx.config }),
        ),
      );
      ctx.onShutdown(() => {
        root.unmount();
      });
    },
  };
}
