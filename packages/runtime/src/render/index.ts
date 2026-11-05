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
  WNode,
  type DomBatch,
  type WElement,
  type WorkerDom,
} from '@isoloop/dom/worker';
import type { IsolateToHost, SerializedEvent } from '@isoloop/protocol';

export { ISOLOOP_DOM_FMT };

const nodeId = (s: string): number | undefined => (/^\d+$/.test(s) ? Number(s) : undefined);

export type Render = {
  /** The render format this runtime speaks. */
  readonly fmt: string;
  /** The isolate's render target: what `ctx.root` is. */
  readonly root: WElement;
  readonly dom: WorkerDom;
  /** Delivers an `event` from the host. Ids that aren't numbers are ignored. */
  receive(event: SerializedEvent): void;
  /** The id the host knows a node by, as host calls send it; `undefined` for anything else. */
  idOf(node: unknown): string | undefined;
  /** Adds stylesheets to the surface; they travel with the next patch (design §4.8). */
  styles(css: string | readonly string[]): void;
};

/**
 * Builds the DOM subset and posts its batches. With `scope`, also installs it
 * as that global's `document` and DOM classes, which frameworks need.
 */
export function createRender(post: (msg: IsolateToHost) => void, scope?: object): Render {
  let pendingStyles: string[] = [];
  let stylesScheduled = false;
  const postPatch = (batch: DomBatch): void => {
    const styles = pendingStyles;
    pendingStyles = [];
    post({
      v: 1,
      t: 'patch',
      p:
        styles.length > 0
          ? { fmt: ISOLOOP_DOM_FMT, batch, styles }
          : { fmt: ISOLOOP_DOM_FMT, batch },
    });
  };
  const dom = createDom({
    onBatch: postPatch,
    schedule: (flush) => queueMicrotask(flush),
  });
  if (scope) install(dom, scope);
  return {
    fmt: ISOLOOP_DOM_FMT,
    root: dom.root,
    dom,
    styles(css) {
      pendingStyles.push(...(typeof css === 'string' ? [css] : css));
      if (stylesScheduled) return;
      stylesScheduled = true;
      queueMicrotask(() => {
        stylesScheduled = false;
        dom.flush();
        // Styles with no DOM change still need a patch to travel in.
        if (pendingStyles.length > 0) postPatch([]);
      });
    },
    idOf: (node) =>
      node instanceof WNode && node.isConnected ? String(dom.idOf(node)) : undefined,
    receive(e) {
      const target = nodeId(e.target);
      if (target === undefined) return;
      const currentTargets = e.currentTargets.map(nodeId).filter((n) => n !== undefined);
      const { target: _t, currentTargets: _c, ...rest } = e;
      dom.deliver({ ...rest, target, currentTargets });
    },
  };
}
