/*
 * Owns every surface and is the only code that writes to them (design §4.4).
 * One rAF per frame applies queued batches round-robin across isolates,
 * starting at a rotating index, while the frame budget lasts. The first batch
 * of a frame always applies, so a frame does at most budget + one batch of
 * work (I8). Batches are never split; leftovers roll to the next frame. Each surface is an <iso-surface> shadow host with the kernel's
 * stylesheets adopted, and a shell the isolate can't touch: a busy overlay
 * and a fallback slot, kept across restarts.
 */
import type { SerializedEvent } from '@isoloop/protocol';
import type { HostRenderBridge } from './render/bridge';

export type SurfaceStats = {
  /** Batches waiting for a frame. */
  queued: number;
  applied: number;
  /** Batches the bridge refused as malformed. */
  rejected: number;
  /** Batches dropped unapplied by a restart. */
  dropped: number;
  /** Milliseconds spent applying this isolate's batches in the last frame it had work. */
  lastFrameMs: number;
};

export type CompositorOptions = {
  /** Adopted into every surface's shadow root. */
  styles?: readonly CSSStyleSheet[];
  /** DOM work per frame, in ms. Default 8 (design §9). */
  frameBudgetMs?: number;
  /** For tests: a fake clock and frame scheduler. */
  now?: () => number;
  requestFrame?: (fn: () => void) => void;
};

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
  dropped: number;
  lastFrameMs: number;
};

export function createCompositor(opts: CompositorOptions = {}): Compositor {
  const {
    styles = [],
    frameBudgetMs = 8,
    now = () => performance.now(),
    requestFrame = (fn) => {
      requestAnimationFrame(fn);
    },
  } = opts;
  const surfaces = new Map<string, Surface>();
  let scheduled = false;
  let rotate = 0;

  const frame = (): void => {
    scheduled = false;
    const order = [...surfaces.values()];
    if (order.length === 0) return;
    const start = rotate++ % order.length;
    const frameStart = now();
    const spent = new Map<Surface, number>();
    let appliedAny = false;
    // Round-robin, one batch per isolate per round, so a chatty isolate can't
    // use up the budget before the others get a turn.
    for (let progress = true; progress;) {
      progress = false;
      for (let i = 0; i < order.length; i++) {
        const s = order[(start + i) % order.length];
        if (!s || s.queue.length === 0) continue;
        if (appliedAny && now() - frameStart >= frameBudgetMs) {
          schedule();
          return finish(spent);
        }
        const t0 = now();
        if (s.bridge.apply(s.queue.shift())) s.applied++;
        else s.rejected++;
        spent.set(s, (spent.get(s) ?? 0) + now() - t0);
        appliedAny = true;
        progress = true;
      }
    }
    finish(spent);
  };

  const finish = (spent: Map<Surface, number>): void => {
    for (const [s, ms] of spent) s.lastFrameMs = ms;
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestFrame(frame);
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
        dropped: 0,
        lastFrameMs: 0,
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
      s.dropped += s.queue.length;
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
      return (
        s && {
          queued: s.queue.length,
          applied: s.applied,
          rejected: s.rejected,
          dropped: s.dropped,
          lastFrameMs: s.lastFrameMs,
        }
      );
    },
  };
}
