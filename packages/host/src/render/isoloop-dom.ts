/*
 * HostRenderBridge for isoloop-dom@1 (ADR 0010, ADR 0011): the applier from
 * @isoloop/dom/host under a container in the surface's shadow root, the
 * component registry as its sanitising policy, and host-owned input rules
 * (design §4.6). The EventBridge (`../events.ts`) listens on the shadow root
 * and asks the applier which events the isolate registered for.
 */
import {
  createApplier,
  ISOLOOP_DOM_FMT,
  type DomEvent,
  type SanitisePolicy,
} from '@isoloop/dom/host';
import type { EventType, SerializedEvent } from '@isoloop/protocol';
import { listenEvents } from '../events';
import type { HostRenderBridge } from './bridge';
import type { ComponentRegistry } from './registry';

export { ISOLOOP_DOM_FMT };

/** An event record from the applier as the protocol's SerializedEvent (ids as strings). */
function serialize(rec: DomEvent, type: EventType): SerializedEvent {
  const event: SerializedEvent = {
    type,
    target: String(rec.target),
    currentTargets: rec.currentTargets.map(String),
    mods: rec.mods,
  };
  if (rec.value !== undefined) event.value = rec.value;
  if (rec.checked !== undefined) event.checked = rec.checked;
  if (rec.key !== undefined) event.key = rec.key;
  if (rec.code !== undefined) event.code = rec.code;
  if (rec.x !== undefined) event.x = rec.x;
  if (rec.y !== undefined) event.y = rec.y;
  if (rec.button !== undefined) event.button = rec.button;
  if (rec.scrollTop !== undefined) event.scrollTop = rec.scrollTop;
  if (rec.scrollLeft !== undefined) event.scrollLeft = rec.scrollLeft;
  return event;
}

const isFocused = (el: Element): boolean => {
  const root = el.getRootNode();
  return (root instanceof ShadowRoot || root instanceof Document) && root.activeElement === el;
};

/**
 * Host-owned inputs (design §4.6): a value or checked state from the isolate
 * is applied only if it differs from the live one and the element isn't
 * focused, so typing never loses characters or jumps the caret. A forced
 * value (`ctx.setValue(node, v, { force: true })`) skips the focus rule.
 */
function hostOwned(el: Element, name: string, value: string | boolean, force: boolean): boolean {
  if (name === 'value') {
    const live =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
        ? el.value
        : undefined;
    return live !== value && (force || !isFocused(el));
  }
  if (name === 'checked') {
    return !(el instanceof HTMLInputElement) || el.checked !== value;
  }
  return true;
}

export type BridgeOptions = {
  /** Rewrites a link's sanitised `href` (ADR 0002: same-origin hrefs become absolute). */
  rewriteHref?: (href: string) => string;
  /** The `<a>` a plain click landed on, if any, and the click. */
  onLink?: (a: HTMLAnchorElement, e: MouseEvent) => void;
};

export function policyFrom(registry: ComponentRegistry, o: BridgeOptions = {}): SanitisePolicy {
  const rewrite = o.rewriteHref;
  return {
    element: (tag, ns) => registry.element(tag, ns),
    attribute: (tag, ns, name, value) => {
      const v = registry.attribute(tag, ns, name, value);
      return v !== null && rewrite && ns === 'html' && tag === 'a' && name.toLowerCase() === 'href'
        ? rewrite(v)
        : v;
    },
    property: (el, name, value, force) =>
      registry.property(el.localName, name) && hostOwned(el, name, value, force),
  };
}

/** The anchor in the shadow tree a click landed on, if any. */
function anchorOf(e: MouseEvent, shadow: ShadowRoot): HTMLAnchorElement | undefined {
  for (const n of e.composedPath()) {
    if (n === shadow) return undefined;
    if (n instanceof HTMLAnchorElement) return n;
  }
  return undefined;
}

export function createIsoloopDomBridge(
  registry: ComponentRegistry,
  o: BridgeOptions = {},
): HostRenderBridge {
  const policy = policyFrom(registry, o);
  const { onLink } = o;
  let applier: ReturnType<typeof createApplier> | null = null;
  let container: HTMLElement | null = null;
  let abort: AbortController | null = null;

  return {
    fmt: ISOLOOP_DOM_FMT,

    mount(shadow, send) {
      container = document.createElement('div');
      container.className = 'iso-root';
      shadow.append(container);
      const a = createApplier(container, policy);
      applier = a;
      abort = new AbortController();
      listenEvents(
        shadow,
        {
          toEvent: (e, type) => {
            const rec = a.eventFor(e);
            return rec ? serialize(rec, type) : null;
          },
          send,
          ...(onLink
            ? {
                onClick: (e: MouseEvent) => {
                  const anchor = anchorOf(e, shadow);
                  if (anchor) onLink(anchor, e);
                },
              }
            : {}),
        },
        abort.signal,
      );
    },

    apply(batch) {
      return applier?.apply(batch) ?? false;
    },

    idFor(node) {
      const id = applier?.idFor(node);
      return id === undefined ? undefined : String(id);
    },

    nodeFor(id) {
      if (!/^\d+$/.test(id)) return undefined;
      const node = applier?.nodeFor(Number(id));
      return node instanceof Element && node !== container ? node : undefined;
    },

    unmount() {
      abort?.abort();
      applier?.clear();
      container?.remove();
      applier = null;
      container = null;
      abort = null;
    },
  };
}
