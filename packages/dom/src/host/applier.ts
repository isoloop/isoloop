/*
 * The host half of isoloop-dom@1 (ADR 0011 point 6): applies batches under a
 * container, keeps node ids both ways, and turns DOM events into event
 * records for the listeners the isolate registered. Every tag, attribute and
 * property passes the sanitising policy first (ADR 0011 point 7, I9); there's
 * no default policy. Timing (the frame budget) and which events to listen for
 * belong to the caller.
 */
import {
  isDomBatch,
  ROOT_ID,
  type DomEvent,
  type DomMods,
  type DomRecord,
  type Namespace,
  type NodeId,
  type SerializedNode,
  type SyncedProp,
} from '../shared/records';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Decides what the applier may create and write. Supplied by the host; required. */
export interface SanitisePolicy {
  /** The host element to create for an isolate's tag. */
  element(tag: string, ns: Namespace): { tag: string; ns: Namespace };
  /** The attribute value to write on a host element, or `null` to drop it. */
  attribute(hostTag: string, ns: Namespace, name: string, value: string): string | null;
  /**
   * Whether to set a synced property on this element now (allow-list and
   * host-owned input rules). `force` asks to override a focused input.
   */
  property(el: Element, name: SyncedProp, value: string | boolean, force: boolean): boolean;
}

export interface Applier {
  /** Applies one batch. Returns false, changing nothing, if its shape is wrong. */
  apply(batch: unknown): boolean;
  idFor(node: Node): NodeId | undefined;
  nodeFor(id: NodeId): Node | undefined;
  /** The event record for a DOM event, or `null` if no node on its path listens for it. */
  eventFor(e: Event): DomEvent | null;
  /** Removes everything the isolate rendered and forgets every id. */
  clear(): void;
}

const isActive = (el: Element): boolean => {
  const root = el.getRootNode();
  return (root instanceof ShadowRoot || root instanceof Document) && root.activeElement === el;
};

const nsOf = (el: Element): Namespace => (el.namespaceURI === SVG_NS ? 'svg' : 'html');

const NO_MODS: DomMods = { alt: false, ctrl: false, meta: false, shift: false };

export function createApplier(container: Element, policy: SanitisePolicy): Applier {
  const nodes = new Map<NodeId, Node>([[ROOT_ID, container]]);
  const ids = new WeakMap<Node, NodeId>([[container, ROOT_ID]]);
  const listens = new Map<NodeId, Set<string>>();

  const setAttr = (el: Element, name: string, value: string | null): void => {
    const safe = value === null ? null : policy.attribute(el.localName, nsOf(el), name, value);
    try {
      if (safe === null) el.removeAttribute(name);
      else el.setAttribute(name, safe);
    } catch {
      // An attribute name the DOM refuses: drop it.
    }
  };

  const setProp = (el: Element, name: SyncedProp, value: string | boolean, force = false): void => {
    if (!policy.property(el, name, value, force)) return;
    if (name === 'checked' && el instanceof HTMLInputElement) el.checked = Boolean(value);
    else if (name === 'selected' && el instanceof HTMLOptionElement) el.selected = Boolean(value);
    else if (
      name === 'value' &&
      (el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement)
    ) {
      el.value = String(value);
      // A forced value replaces what the user is typing: the caret goes to its end.
      if (force && !(el instanceof HTMLSelectElement) && isActive(el)) {
        try {
          el.setSelectionRange(el.value.length, el.value.length);
        } catch {
          // Input types without a selection (number, email…).
        }
      }
    }
  };

  const listen = (id: NodeId, type: string, on: boolean): void => {
    const set = listens.get(id) ?? new Set<string>();
    if (on) set.add(type);
    else set.delete(type);
    if (set.size > 0) listens.set(id, set);
    else listens.delete(id);
  };

  const build = (s: SerializedNode): Node => {
    let node: Node;
    if (s.k === 'text') node = document.createTextNode(s.data);
    else if (s.k === 'comment') node = document.createComment(s.data);
    else {
      const { tag, ns } = policy.element(s.tag, s.ns);
      const el = document.createElementNS(ns === 'svg' ? SVG_NS : HTML_NS, tag);
      for (const [name, value] of s.attrs) setAttr(el, name, value);
      for (const c of s.children) el.append(build(c));
      for (const [name, value] of s.props) setProp(el, name, value);
      for (const type of s.listen) listen(s.id, type, true);
      node = el;
    }
    nodes.set(s.id, node);
    ids.set(node, s.id);
    return node;
  };

  const forget = (node: Node): void => {
    const id = ids.get(node);
    if (id !== undefined) {
      nodes.delete(id);
      listens.delete(id);
      ids.delete(node);
    }
    for (const c of node.childNodes) forget(c);
  };

  /** Moves keep the node, but browsers drop focus from a moved subtree; put it back. */
  const move = (parent: Node, node: Node, before: Node | null): void => {
    const root = container.getRootNode();
    const active =
      root instanceof ShadowRoot || root instanceof Document ? root.activeElement : null;
    const keep = active && node.contains(active) ? active : null;
    const range =
      keep instanceof HTMLInputElement || keep instanceof HTMLTextAreaElement
        ? { start: keep.selectionStart, end: keep.selectionEnd }
        : null;
    parent.insertBefore(node, before);
    if (keep instanceof HTMLElement || keep instanceof SVGElement) {
      keep.focus({ preventScroll: true });
      if (range && (keep instanceof HTMLInputElement || keep instanceof HTMLTextAreaElement)) {
        try {
          keep.setSelectionRange(range.start, range.end);
        } catch {
          // Input types without a selection (number, email…).
        }
      }
    }
  };

  const applyRecord = (r: DomRecord): void => {
    switch (r[0]) {
      case 'insert': {
        const parent = nodes.get(r[1]);
        if (!parent) return;
        const before = r[3] === null ? null : (nodes.get(r[3]) ?? null);
        parent.insertBefore(build(r[2]), before?.parentNode === parent ? before : null);
        return;
      }
      case 'move': {
        const parent = nodes.get(r[1]);
        const node = nodes.get(r[2]);
        if (!parent || !node) return;
        const before = r[3] === null ? null : (nodes.get(r[3]) ?? null);
        move(parent, node, before?.parentNode === parent ? before : null);
        return;
      }
      case 'remove': {
        const node = nodes.get(r[1]);
        if (!node || r[1] === ROOT_ID) return;
        node.parentNode?.removeChild(node);
        forget(node);
        return;
      }
      case 'text': {
        const node = nodes.get(r[1]);
        if (node instanceof CharacterData) node.data = r[2];
        return;
      }
      case 'attr': {
        const el = nodes.get(r[1]);
        if (el instanceof Element && el !== container) setAttr(el, r[2], r[3]);
        return;
      }
      case 'prop': {
        const el = nodes.get(r[1]);
        if (el instanceof Element) setProp(el, r[2], r[3], r[4] === true);
        return;
      }
      case 'listen':
        if (nodes.has(r[1])) listen(r[1], r[2], r[3]);
        return;
    }
  };

  return {
    apply(batch) {
      if (!isDomBatch(batch)) return false;
      for (const r of batch) {
        try {
          applyRecord(r);
        } catch {
          // A record the DOM refuses (e.g. a move that would make a cycle) is skipped.
        }
      }
      return true;
    },

    idFor: (node) => ids.get(node),
    nodeFor: (id) => nodes.get(id),

    eventFor(e) {
      const path = e.composedPath();
      let target: NodeId | undefined;
      const currentTargets: NodeId[] = [];
      for (const t of path) {
        if (!(t instanceof Node)) continue;
        const id = ids.get(t);
        if (id === undefined) continue;
        target ??= id;
        if (listens.get(id)?.has(e.type)) currentTargets.push(id);
        if (t === container) break;
      }
      if (target === undefined || currentTargets.length === 0) return null;
      const out: DomEvent = { type: e.type, target, currentTargets, mods: NO_MODS };
      const el = nodes.get(target);
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      )
        out.value = el.value;
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio'))
        out.checked = el.checked;
      if (e instanceof MouseEvent || e instanceof KeyboardEvent) {
        out.mods = { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };
      }
      if (e instanceof KeyboardEvent) {
        out.key = e.key;
        out.code = e.code;
      }
      if (e.type === 'scroll' && el instanceof Element) {
        out.scrollTop = el.scrollTop;
        out.scrollLeft = el.scrollLeft;
      }
      if (e instanceof MouseEvent) {
        out.x = e.clientX;
        out.y = e.clientY;
        out.button = e.button;
      }
      return out;
    },

    clear() {
      for (const c of Array.from(container.childNodes)) {
        container.removeChild(c);
        forget(c);
      }
      listens.clear();
    },
  };
}
