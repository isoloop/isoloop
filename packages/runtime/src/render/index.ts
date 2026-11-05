/*
 * The isolate side of rendering (ADR 0011 point 6): the isoloop-dom subset
 * from @isoloop/dom/worker, flushed once per microtask into one `patch`, and
 * events from the host delivered back to it. The runtime owns the timing;
 * `dom` owns the format.
 */
import {
  createDom,
  install,
  ISOLOOP_DOM_FMT,
  type WElement,
  type WorkerDom,
} from '@isoloop/dom/worker';
import type { IsolateToHost, SerializedEvent } from '@isoloop/protocol';

export { ISOLOOP_DOM_FMT };

const nodeId = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : undefined);

export type Render = {
  /** The isolate's render target: what `ctx.root` is. */
  readonly root: WElement;
  readonly dom: WorkerDom;
  /** Delivers an `event` from the host. Ids that aren't numbers are ignored. */
  receive(event: SerializedEvent): void;
};

/**
 * Builds the DOM subset and posts its batches. With `scope`, also installs it
 * as that global's `document` and DOM classes, which frameworks need.
 */
export function createRender(post: (msg: IsolateToHost) => void, scope?: object): Render {
  const dom = createDom({
    onBatch: (batch) => post({ v: 1, t: 'patch', p: { fmt: ISOLOOP_DOM_FMT, batch } }),
    schedule: (flush) => queueMicrotask(flush),
  });
  if (scope) install(dom, scope);
  return {
    root: dom.root,
    dom,
    receive(e) {
      const target = nodeId(e.target);
      if (target === undefined) return;
      const currentTargets = e.currentTargets.map(nodeId).filter((n) => n !== undefined);
      const { target: _t, currentTargets: _c, ...rest } = e;
      dom.deliver({ ...rest, target, currentTargets });
    },
  };
}
