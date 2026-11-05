/*
 * Owns every surface and is the only code that writes to them (design §4.4).
 * M0: one rAF per frame that applies every queued batch, with no frame budget
 * yet. Each surface is an <iso-surface> shadow host with the kernel's
 * stylesheets adopted, and a shell the isolate can't touch: a busy overlay
 * and a fallback slot, kept across restarts.
 */
import type { SerializedEvent } from '@isoloop/protocol';
import type { HostRenderBridge } from './render/bridge';

export type SurfaceStats = { queued: number; applied: number; rejected: number };

/** What a failed isolate's fallback shows (design §4.3). */
export type FallbackInfo = {
  id: string;
  reason: string;
  message: string;
  /** Respawns the isolate, resetting its restart window. */
  respawn: () => void;
};

/**
 * Renders a failed isolate's fallback into `slot`, an element in the surface's
 * shadow root that the compositor empties when the fallback is hidden.
 */
export type FallbackRender = (slot: HTMLElement, info: FallbackInfo) => void;

const SHELL_CSS = `
:host { display: block; position: relative; }
.iso-busy, .iso-fallback { position: absolute; inset: 0; z-index: 2147483647; }
.iso-busy { cursor: progress; background: rgb(128 128 128 / 0.25); }
.iso-busy::after {
  content: 'Not responding…'; position: absolute; top: 0.5em; right: 0.5em;
  padding: 0.2em 0.5em; border-radius: 0.3em; font: 12px/1.4 system-ui, sans-serif;
  color: #fff; background: rgb(0 0 0 / 0.6);
}
.iso-fallback { overflow: auto; padding: 1em; background: Canvas; color: CanvasText; font: 14px/1.4 system-ui, sans-serif; }
.iso-busy[hidden], .iso-fallback[hidden] { display: none; }
`;

let shellSheet: CSSStyleSheet | undefined;
const shell = (): CSSStyleSheet => {
  if (!shellSheet) {
    shellSheet = new CSSStyleSheet();
    shellSheet.replaceSync(SHELL_CSS);
  }
  return shellSheet;
};

export const defaultFallback: FallbackRender = (slot, info) => {
  const title = document.createElement('strong');
  title.textContent = `"${info.id}" stopped working`;
  const detail = document.createElement('p');
  detail.textContent = info.message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.addEventListener('click', info.respawn);
  slot.append(title, detail, retry);
};

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
  /** Shows or hides the busy overlay. */
  busy(id: string, on: boolean): void;
  /** Shows the fallback, rendered by `render`, or hides it with `null`. */
  fallback(id: string, info: FallbackInfo | null, render?: FallbackRender): void;
  stats(id: string): SurfaceStats | undefined;
}

type Surface = {
  host: HTMLElement;
  shadow: ShadowRoot;
  busy: HTMLElement;
  fallback: HTMLElement;
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
      shadow.adoptedStyleSheets = [shell(), ...styles];
      const busy = document.createElement('div');
      busy.className = 'iso-busy';
      busy.hidden = true;
      const fallback = document.createElement('div');
      fallback.className = 'iso-fallback';
      fallback.setAttribute('role', 'alert');
      fallback.hidden = true;
      shadow.append(busy, fallback);
      target.append(host);
      bridge.mount(shadow, send);
      surfaces.set(id, {
        host,
        shadow,
        busy,
        fallback,
        bridge,
        send,
        queue: [],
        applied: 0,
        rejected: 0,
      });
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

    busy(id, on) {
      const s = surfaces.get(id);
      if (s) s.busy.hidden = !on;
    },

    fallback(id, info, render = defaultFallback) {
      const s = surfaces.get(id);
      if (!s) return;
      s.fallback.replaceChildren();
      s.fallback.hidden = info === null;
      if (info) render(s.fallback, info);
    },

    stats(id) {
      const s = surfaces.get(id);
      return s && { queued: s.queue.length, applied: s.applied, rejected: s.rejected };
    },
  };
}
