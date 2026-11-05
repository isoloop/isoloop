/*
 * HostRenderBridge for isoloop-dom@1 (ADR 0010, ADR 0011): the applier from
 * @isoloop/dom/host under a container in the surface's shadow root, the
 * component registry as its sanitising policy, and host-owned input rules
 * (design §4.6). Delegated listeners for the fixed event set turn DOM events
 * into SerializedEvents; default actions move to the EventBridge in task 8.
 */
import { createApplier, ISOLOOP_DOM_FMT, type SanitisePolicy } from '@isoloop/dom/host';
import type { EventType, SerializedEvent } from '@isoloop/protocol';
import type { HostRenderBridge } from './bridge';
import type { ComponentRegistry } from './registry';

export { ISOLOOP_DOM_FMT };

/** Event types the host forwards (design §4.6). Pointer moves are opt-in and come later. */
const EVENTS: readonly EventType[] = [
  'click',
  'dblclick',
  'input',
  'change',
  'keydown',
  'keyup',
  'submit',
  'focusin',
  'focusout',
  'pointerdown',
  'pointerup',
];

const isFocused = (el: Element): boolean => {
  const root = el.getRootNode();
  return (root instanceof ShadowRoot || root instanceof Document) && root.activeElement === el;
};

/**
 * Host-owned inputs (design §4.6): a value or checked state from the isolate
 * is applied only if it differs from the live one and the element isn't
 * focused, so typing never loses characters or jumps the caret.
 */
function hostOwned(el: Element, name: string, value: string | boolean): boolean {
  if (name === 'value') {
    const live =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
        ? el.value
        : undefined;
    return live !== value && !isFocused(el);
  }
  if (name === 'checked') {
    return !(el instanceof HTMLInputElement) || el.checked !== value;
  }
  return true;
}

export function policyFrom(registry: ComponentRegistry): SanitisePolicy {
  return {
    element: (tag, ns) => registry.element(tag, ns),
    attribute: (tag, ns, name, value) => registry.attribute(tag, ns, name, value),
    property: (el, name, value) =>
      registry.property(el.localName, name) && hostOwned(el, name, value),
  };
}

export function createIsoloopDomBridge(registry: ComponentRegistry): HostRenderBridge {
  const policy = policyFrom(registry);
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
      for (const type of EVENTS) {
        shadow.addEventListener(
          type,
          (e) => {
            const rec = a.eventFor(e);
            if (!rec) return;
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
            send(event);
          },
          { signal: abort.signal },
        );
      }
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
