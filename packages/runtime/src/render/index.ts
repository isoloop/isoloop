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
  type DomEvent,
  type NodeId,
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
  /** Sends this isolate's pending records now. */
  flush(): void;
  /** `ctx.setValue` (M3a task 6), for this isolate's own nodes. */
  setValue(node: WNode, value: string, opts?: { force?: boolean }): void;
  /** A pool member stopping: its root leaves the shared document (ADR 0015). */
  dispose(): void;
  /** Delivers an `event` from the host. Ids that aren't numbers are ignored. */
  receive(event: SerializedEvent): void;
  /** The id the host knows a node by, as host calls send it; `undefined` for anything else. */
  idOf(node: unknown): string | undefined;
  /** Adds stylesheets to the surface; they travel with the next patch (design §4.8). */
  styles(css: string | readonly string[]): void;
};

/** What a render draws into: the whole document's root, or a member's root in a pool. */
type Target = {
  root: WElement;
  flush(): void;
  deliver(event: DomEvent): void;
  idOf(node: WNode): NodeId | undefined;
  setValue(node: WNode, value: string, opts?: { force?: boolean }): void;
  dispose(): void;
};

/**
 * A pool's one document (ADR 0015): every visual member renders into its own
 * root in it, so frameworks and libraries see a single `document`, as on a
 * page. Made by the first visual member.
 */
let shared: WorkerDom | null = null;
/** Members told about head tags: the head is the document's, not one member's. */
const headListeners = new Set<(tag: string) => void>();

function sharedDom(scope: object | undefined): WorkerDom {
  if (!shared) {
    shared = createDom({
      // The document's own root isn't any member's; nothing renders into it.
      onBatch: () => {},
      onHead: (tag) => {
        for (const fn of headListeners) fn(tag);
      },
    });
    if (scope) install(shared, scope);
  }
  return shared;
}

/**
 * Builds the DOM subset and posts its batches. With `scope`, also installs it
 * as that global's `document` and DOM classes, which frameworks need. With
 * `pooled`, the isolate gets its own root in the worker's shared document
 * instead (ADR 0015).
 */
export function createRender(
  post: (msg: IsolateToHost) => void,
  scope?: object,
  pooled = false,
): Render {
  let pendingStyles: string[] = [];
  let pendingHead: string[] = [];
  /** Head tags already reported: each goes to the host once. */
  const headSeen = new Set<string>();
  let extrasScheduled = false;
  const postPatch = (batch: DomBatch): void => {
    const styles = pendingStyles;
    const head = pendingHead;
    pendingStyles = [];
    pendingHead = [];
    post({
      v: 1,
      t: 'patch',
      p: {
        fmt: ISOLOOP_DOM_FMT,
        batch,
        ...(styles.length > 0 ? { styles } : {}),
        ...(head.length > 0 ? { head } : {}),
      },
    });
  };
  /** Styles or head tags with no DOM change still need a patch to travel in. */
  const scheduleExtras = (): void => {
    if (extrasScheduled) return;
    extrasScheduled = true;
    queueMicrotask(() => {
      extrasScheduled = false;
      target.flush();
      if (pendingStyles.length > 0 || pendingHead.length > 0) postPatch([]);
    });
  };
  const onHead = (tag: string): void => {
    if (headSeen.has(tag)) return;
    headSeen.add(tag);
    pendingHead.push(tag);
    scheduleExtras();
  };
  let target: Target;
  if (pooled) {
    const member = sharedDom(scope).addRoot({ onBatch: postPatch });
    headListeners.add(onHead);
    target = {
      ...member,
      dispose() {
        headListeners.delete(onHead);
        member.dispose();
      },
    };
  } else {
    const dom = createDom({
      onBatch: postPatch,
      schedule: (flush) => queueMicrotask(flush),
      onHead,
    });
    if (scope) install(dom, scope);
    target = {
      root: dom.root,
      flush: () => dom.flush(),
      deliver: (event) => dom.deliver(event),
      idOf: (node) => (node.isConnected ? dom.idOf(node) : undefined),
      setValue: (node, value, o) => dom.setValue(node, value, o),
      dispose: () => {},
    };
  }
  return {
    fmt: ISOLOOP_DOM_FMT,
    root: target.root,
    flush: () => target.flush(),
    setValue: (node, value, o) => target.setValue(node, value, o),
    dispose: () => target.dispose(),
    styles(css) {
      pendingStyles.push(...(typeof css === 'string' ? [css] : css));
      scheduleExtras();
    },
    idOf(node) {
      if (!(node instanceof WNode)) return undefined;
      const id = target.idOf(node);
      return id === undefined ? undefined : String(id);
    },
    receive(e) {
      const t = nodeId(e.target);
      if (t === undefined) return;
      const currentTargets = e.currentTargets.map(nodeId).filter((n) => n !== undefined);
      const { target: _t, currentTargets: _c, ...rest } = e;
      target.deliver({ ...rest, target: t, currentTargets });
    },
  };
}
