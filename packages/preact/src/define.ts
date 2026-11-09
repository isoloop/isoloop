/*
 * `defineIsolate(Component)` (ADR 0010): an isolate module's default export
 * that renders `Component` into `ctx.root` with Preact, under the isolate
 * context, and unmounts it on shutdown so effects clean up (unsubscribing,
 * among others).
 */
import { REQUIRES, type IsolateContext, type IsolateDefinition } from '@isoloop/runtime';
import {
  Component as ComponentBase,
  h,
  render,
  type ComponentChildren,
  type ComponentType,
} from 'preact';
import { IsolateCtx } from './context';

/** Props every isolate component gets: `manifest.config`, passed through. */
export type IsolateProps = { config: unknown };

type BoundaryProps = { ctx: IsolateContext; children?: ComponentChildren };

/**
 * Catches a render error at the isolate's root and reports it as this
 * isolate's own (`ctx.reportError`), so in a pool it crashes only this member
 * (ADR 0015, decision 8). Under a runtime without `reportError` (ADR 0012) the
 * error is rethrown, as before.
 */
class Boundary extends ComponentBase<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  static override getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    const { ctx } = this.props;
    if (typeof ctx.reportError === 'function') ctx.reportError(error);
    else
      queueMicrotask(() => {
        throw error;
      });
  }
  override render(): ComponentChildren {
    return this.state.failed ? null : this.props.children;
  }
}

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
        h(
          IsolateCtx.Provider,
          { value: ctx },
          h(Boundary, { ctx }, h(Component, { config: ctx.config })),
        ),
        container,
      );
      ctx.onShutdown(() => {
        render(null, container);
      });
    },
  };
}
