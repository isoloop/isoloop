/*
 * Owns every surface and is the only code that writes to them (design §4.4).
 * M0: one rAF per frame that applies every queued batch, with no frame budget
 * yet. Each surface is an <iso-surface> shadow host with the kernel's
 * stylesheets adopted.
 */
import type { SerializedEvent } from '@isoloop/protocol';
import type { HostRenderBridge } from './render/bridge';

export type SurfaceStats = { queued: number; applied: number; rejected: number };

export interface Compositor {
  /** Creates the surface for an isolate inside `target`. */
  attach(
    id: string,
    target: Element,
    bridge: HostRenderBridge,
    send: (e: SerializedEvent) => void,
  ): void;
  enqueue(id: string, batch: unknown): void;
  /** Drops the queue and the surface's content, keeps the surface (restart). */
  reset(id: string, bridge: HostRenderBridge): void;
  /** Removes the surface (stop). */
  detach(id: string): void;
  stats(id: string): SurfaceStats | undefined;
}

type Surface = {
  host: HTMLElement;
  shadow: ShadowRoot;
  bridge: HostRenderBridge;
  send: (e: SerializedEvent) => void;
  queue: unknown[];
  applied: number;
  rejected: number;
};

export function createCompositor(styles: readonly CSSStyleSheet[] = []): Compositor {
  const surfaces = new Map<string, Surface>();
  let raf = 0;

  const frame = (): void => {
    raf = 0;
    for (const s of surfaces.values()) {
      for (const batch of s.queue.splice(0)) {
        if (s.bridge.apply(batch)) s.applied++;
        else s.rejected++;
      }
    }
  };

  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  return {
    attach(id, target, bridge, send) {
      const host = document.createElement('iso-surface');
      host.dataset['isolateId'] = id;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.adoptedStyleSheets = [...styles];
      target.append(host);
      bridge.mount(shadow, send);
      surfaces.set(id, { host, shadow, bridge, send, queue: [], applied: 0, rejected: 0 });
    },

    enqueue(id, batch) {
      const s = surfaces.get(id);
      if (!s) return;
      s.queue.push(batch);
      schedule();
    },

    reset(id, bridge) {
      const s = surfaces.get(id);
      if (!s) return;
      s.queue.length = 0;
      s.bridge.unmount();
      s.bridge = bridge;
      bridge.mount(s.shadow, s.send);
    },

    detach(id) {
      const s = surfaces.get(id);
      if (!s) return;
      s.bridge.unmount();
      s.host.remove();
      surfaces.delete(id);
    },

    stats(id) {
      const s = surfaces.get(id);
      return s && { queued: s.queue.length, applied: s.applied, rejected: s.rejected };
    },
  };
}
