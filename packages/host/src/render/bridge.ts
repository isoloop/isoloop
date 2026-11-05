import type { SerializedEvent } from '@isoloop/protocol';

/**
 * Host side of a render format (design §4.5). The compositor is the only
 * caller of `apply`. Bridges wire their own delegated events for now; task 8
 * moves that, with default actions, to an EventBridge using `idFor`.
 */
export interface HostRenderBridge {
  /** `ready.renderFmt` this bridge reads, e.g. `isoloop-dom@1`. */
  readonly fmt: string;
  mount(root: ShadowRoot, send: (event: SerializedEvent) => void): void;
  /** Applies one batch. Returns false and changes nothing if the batch is malformed. */
  apply(batch: unknown): boolean;
  /** The isolate's id for a host node (EventBridge). `legacy-vdom` has none. */
  idFor?(node: Node): string | undefined;
  /** The host element for an isolate's node id (measure, focus). `legacy-vdom` has none. */
  nodeFor?(id: string): Element | undefined;
  unmount(): void;
}
