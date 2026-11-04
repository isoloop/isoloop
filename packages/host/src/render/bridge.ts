import type { SerializedEvent } from '@isoloop/protocol';

/**
 * Host side of a render format (design §4.5), reduced to what M0 needs. The
 * compositor is the only caller of `apply`. M0 bridges also wire their own
 * events; M1 moves that to an EventBridge using `idFor`.
 */
export interface HostRenderBridge {
  /** `patch.fmt` this bridge reads, e.g. `legacy-vdom@1`. */
  readonly fmt: string;
  mount(root: ShadowRoot, send: (event: SerializedEvent) => void): void;
  /** Applies one batch. Returns false and changes nothing if the batch is malformed. */
  apply(batch: unknown): boolean;
  unmount(): void;
}
