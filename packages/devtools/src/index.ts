/*
 * `@isoloop/devtools` (M4b): a panel in the page showing the inspection feed
 * (ADR 0020), drawn by a visual isolate in its own worker, so a devtools
 * crash or hang never touches the app, and it restarts like any isolate
 * (M4b devtools decisions 1–8). The app imports and mounts it; that import is
 * the opt-in, production builds included (decision 3).
 *
 * The host side here only makes the surface, spawns the panel isolate with
 * the `inspect` grant, and turns the keyboard shortcut into a click on the
 * panel's toggle. Everything drawn, the floating button included, is the
 * isolate's.
 */
import type { FallbackRender, Kernel } from '@isoloop/host';

/** The corner the floating button and the docked panel sit in. @experimental */
export type DevtoolsPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** @experimental */
export type DevtoolsOptions = {
  /**
   * The panel isolate's module URL. Defaults to the `panel.js` next to this
   * module in the published package. With `@isoloop/vite`, pass
   * `import panel from '@isoloop/devtools/panel?isolate'` instead, so the
   * build emits it like the app's own isolates.
   */
  src?: string;
  /** Where the closed button and the opened panel sit. Default `'bottom-right'`. */
  position?: DevtoolsPosition;
  /** The panel isolate's id in the kernel. Default `'isoloop-devtools'`. */
  id?: string;
};

/** A mounted panel. @experimental */
export type Devtools = {
  /** The panel isolate's id. */
  readonly id: string;
  /** Opens or closes the panel, as a click on its button does. */
  toggle(): void;
  /** Stops the panel isolate and removes its surface. */
  unmount(): Promise<void>;
};

/** The attribute the panel puts on its open and close buttons. */
const TOGGLE = '[data-isoloop-devtools-toggle]';

/** Alt+Shift+D (Option+Shift+D on a Mac) opens and closes the panel. */
const isShortcut = (e: KeyboardEvent): boolean =>
  e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyD';

const panelUrl = (): string => new URL('./panel.js', import.meta.url).href;

/**
 * A small box in the panel's corner once it has given up, with a Retry. The
 * surface covers the viewport without taking pointer events, so the default
 * fallback would sit unclickable at the top left.
 */
const fallbackFor =
  (position: DevtoolsPosition): FallbackRender =>
  (slot, info) => {
    const [v, h] = position.split('-');
    const box = document.createElement('div');
    box.setAttribute(
      'style',
      `position:fixed;${v}:12px;${h}:12px;pointer-events:auto;padding:8px 10px;` +
        'border-radius:8px;font:12px/1.4 system-ui,sans-serif;color:#fff;background:#7f1d1d;',
    );
    box.textContent = 'Devtools stopped. ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', info.respawn);
    box.append(retry);
    slot.append(box);
  };

/**
 * Mounts the devtools panel: a surface covering the viewport that takes no
 * pointer events itself (the panel's boxes are `position: fixed`), and the
 * panel isolate in its own worker with the `inspect` grant (never pooled).
 * Alt+Shift+D toggles it. Guide: `docs/guide/devtools.md`.
 *
 * ```ts
 * import { mountDevtools } from '@isoloop/devtools';
 * mountDevtools(kernel, { position: 'bottom-left' });
 * ```
 * @experimental
 */
export function mountDevtools(kernel: Kernel, o: DevtoolsOptions = {}): Devtools {
  const id = o.id ?? 'isoloop-devtools';
  const position = o.position ?? 'bottom-right';
  const surface = document.createElement('div');
  surface.setAttribute('data-isoloop-devtools', '');
  // Inline, so it wins over the shadow root's `:host` rule.
  surface.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;',
  );
  document.body.append(surface);

  kernel.spawn({
    id,
    src: o.src ?? panelUrl(),
    surface,
    config: { position },
    grants: { publish: [], subscribe: [], inspect: true },
    fallback: fallbackFor(position),
  });

  const toggle = (): void => {
    // The compositor draws into a shadow root on an element of its own.
    const button = surface.querySelector('iso-surface')?.shadowRoot?.querySelector(TOGGLE);
    if (button instanceof HTMLElement) button.click();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!isShortcut(e)) return;
    e.preventDefault();
    toggle();
  };
  window.addEventListener('keydown', onKey);

  let gone: Promise<void> | undefined;
  return {
    id,
    toggle,
    unmount() {
      gone ??= (async () => {
        window.removeEventListener('keydown', onKey);
        await kernel.stop(id);
        surface.remove();
      })();
      return gone;
    },
  };
}
