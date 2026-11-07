/*
 * The worker-side DOM subset (ADR 0010 point 2): exactly what Preact and
 * React call, recorded as isoloop-dom@1 records while it changes. A node is
 * "known" once the host has been told about it (it's in the tree under the
 * root); only changes to known nodes become records, and a subtree that joins
 * the tree is sent whole in one `insert`. Moves inside the tree are one
 * `move` record, so the host keeps node identity.
 *
 * Nothing here touches a global: `createDom()` builds a self-contained
 * document, and `install()` exposes it as the worker's `document`.
 */
import {
  ROOT_ID,
  type DomBatch,
  type DomEvent,
  type DomRecord,
  type Namespace,
  type NodeId,
  type SerializedNode,
  type SyncedProp,
} from '../shared/records';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';

type ListenerFn = (event: Event) => void;
type Listener = { fn: ListenerFn | { handleEvent: ListenerFn }; capture: boolean; once: boolean };

/** Strings as the DOM coerces them: numbers and booleans become text, null and undefined empty. */
const str = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint'
      ? String(v)
      : '';

const domError = (name: string, message: string): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

/** Shared state of one document: ids, the recorder, known nodes. */
type Core = {
  /** The render root, set by `createDom()`. */
  root: WElement | null;
  nextId: number;
  known: Map<NodeId, WNode>;
  record(r: DomRecord): void;
  /** An element was inserted into `document.head`, which the bridge doesn't render. */
  onHead(tag: string): void;
};

/** Listener storage and capture/bubble dispatch through `isoParentTarget()`. */
export class WEventTarget {
  /** @internal */ isoListeners: Map<string, Listener[]> = new Map();

  /** @internal */ isoParentTarget(): WEventTarget | null {
    return null;
  }

  /** @internal Called when the first listener of `type` is added, or the last removed. */
  isoListenChanged(_type: string, _on: boolean): void {}

  addEventListener(
    type: string,
    fn: ListenerFn | { handleEvent: ListenerFn } | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!fn) return;
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const once = typeof options === 'object' && Boolean(options.once);
    const list = this.isoListeners.get(type) ?? [];
    if (list.some((l) => l.fn === fn && l.capture === capture)) return;
    list.push({ fn, capture, once });
    this.isoListeners.set(type, list);
    if (list.length === 1) this.isoListenChanged(type, true);
  }

  removeEventListener(
    type: string,
    fn: ListenerFn | { handleEvent: ListenerFn } | null,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const list = this.isoListeners.get(type);
    if (!list) return;
    const i = list.findIndex((l) => l.fn === fn && l.capture === capture);
    if (i < 0) return;
    list.splice(i, 1);
    if (list.length === 0) {
      this.isoListeners.delete(type);
      this.isoListenChanged(type, false);
    }
  }

  /** Capture from the top, then the target, then bubble (if `bubbles`). */
  dispatchEvent(event: Event): boolean {
    const path: WEventTarget[] = [this];
    for (let t = this.isoParentTarget(); t; t = t.isoParentTarget()) path.push(t);
    let stopped = false;
    let stoppedNow = false;
    const stop = event.stopPropagation.bind(event);
    const stopNow = event.stopImmediatePropagation.bind(event);
    Object.defineProperties(event, {
      target: { value: this, configurable: true },
      srcElement: { value: this, configurable: true },
      stopPropagation: {
        value: () => {
          stopped = true;
          stop();
        },
        configurable: true,
      },
      stopImmediatePropagation: {
        value: () => {
          stopped = true;
          stoppedNow = true;
          stopNow();
        },
        configurable: true,
      },
      composedPath: { value: () => path.slice(), configurable: true },
    });
    const invoke = (t: WEventTarget, phase: number, capture: boolean | null) => {
      Object.defineProperties(event, {
        currentTarget: { value: t, configurable: true },
        eventPhase: { value: phase, configurable: true },
      });
      for (const l of (t.isoListeners.get(event.type) ?? []).slice()) {
        if (capture !== null && l.capture !== capture) continue;
        if (l.once) t.removeEventListener(event.type, l.fn, l.capture);
        if (typeof l.fn === 'function') l.fn.call(t, event);
        else l.fn.handleEvent(event);
        if (stoppedNow) return;
      }
    };
    // [target, eventPhase, capture listeners only?]: capture top-down, target, bubble bottom-up.
    const phases: [WEventTarget, number, boolean | null][] = [];
    for (let i = path.length - 1; i > 0; i--) {
      const t = path[i];
      if (t) phases.push([t, 1, true]);
    }
    phases.push([this, 2, null]);
    if (event.bubbles) for (const t of path.slice(1)) phases.push([t, 3, false]);
    for (const [t, phase, capture] of phases) {
      if (stopped) break;
      invoke(t, phase, capture);
    }
    Object.defineProperties(event, {
      currentTarget: { value: null, configurable: true },
      eventPhase: { value: 0, configurable: true },
    });
    return !event.defaultPrevented;
  }
}

export abstract class WNode extends WEventTarget {
  static readonly ELEMENT_NODE = 1;
  static readonly TEXT_NODE = 3;
  static readonly COMMENT_NODE = 8;
  static readonly DOCUMENT_NODE = 9;
  static readonly DOCUMENT_FRAGMENT_NODE = 11;
  readonly ELEMENT_NODE = 1;
  readonly TEXT_NODE = 3;
  readonly COMMENT_NODE = 8;
  readonly DOCUMENT_FRAGMENT_NODE = 11;

  abstract readonly nodeType: number;
  abstract readonly nodeName: string;
  readonly ownerDocument: WDocument;
  /** @internal */ readonly isoId: NodeId;
  /** @internal */ isoParent: WParentNode | null = null;
  /** @internal */ isoPrev: WNode | null = null;
  /** @internal */ isoNext: WNode | null = null;
  /** @internal Whether the host knows this node (it's in the tree under the root). */
  isoKnown = false;

  constructor(doc: WDocument, id: NodeId) {
    super();
    this.ownerDocument = doc;
    this.isoId = id;
  }

  /** @internal */ override isoParentTarget(): WEventTarget | null {
    return this.isoParent;
  }

  /** @internal */ override isoListenChanged(type: string, on: boolean): void {
    if (this.isoKnown) this.ownerDocument.isoCore.record(['listen', this.isoId, type, on]);
  }

  get parentNode(): WParentNode | null {
    return this.isoParent;
  }
  get parentElement(): WElement | null {
    return this.isoParent instanceof WElement ? this.isoParent : null;
  }
  get nextSibling(): WNode | null {
    return this.isoNext;
  }
  get previousSibling(): WNode | null {
    return this.isoPrev;
  }
  get firstChild(): WNode | null {
    return null;
  }
  get lastChild(): WNode | null {
    return null;
  }
  get childNodes(): readonly WNode[] {
    return [];
  }
  get isConnected(): boolean {
    return this.isoKnown;
  }
  abstract get textContent(): string;
  abstract set textContent(v: string | null);
  abstract get nodeValue(): string | null;
  abstract set nodeValue(v: string | null);

  hasChildNodes(): boolean {
    return this.firstChild !== null;
  }

  contains(other: WNode | null): boolean {
    for (let n: WNode | null = other; n; n = n.isoParent) if (n === this) return true;
    return false;
  }

  remove(): void {
    this.isoParent?.removeChild(this);
  }
}

/** What text and comment nodes share: `data`, changed with a `text` record. */
export abstract class WCharacterData extends WNode {
  /** @internal */ isoData: string;

  constructor(doc: WDocument, id: NodeId, data: string) {
    super(doc, id);
    this.isoData = data;
  }

  get data(): string {
    return this.isoData;
  }
  set data(v: unknown) {
    const data = str(v);
    if (data === this.isoData) return;
    this.isoData = data;
    if (this.isoKnown) this.ownerDocument.isoCore.record(['text', this.isoId, data]);
  }
  get length(): number {
    return this.isoData.length;
  }
  get textContent(): string {
    return this.isoData;
  }
  set textContent(v: string | null) {
    this.data = v ?? '';
  }
  get nodeValue(): string | null {
    return this.isoData;
  }
  set nodeValue(v: string | null) {
    this.data = v ?? '';
  }
}

export class WText extends WCharacterData {
  readonly nodeType = 3;
  readonly nodeName = '#text';
}

/** A comment node (DOM group 1, ADR 0010): rendered on the host, inert there. */
export class WComment extends WCharacterData {
  readonly nodeType = 8;
  readonly nodeName = '#comment';
}

/** What `element.style` offers: declarations by property name, plus the methods frameworks call. */
export type WStyle = {
  setProperty(name: string, value: string | null): void;
  removeProperty(name: string): string;
  getPropertyValue(name: string): string;
  cssText: string;
  [property: string]: unknown;
};

/** `element.style`: property writes and setProperty, kept as the `style` attribute. */
const kebab = (name: string): string =>
  name.startsWith('--') ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function createStyle(el: WElement): WStyle {
  const decls = new Map<string, string>();
  const write = () => {
    const text = [...decls].map(([k, v]) => `${k}: ${v};`).join(' ');
    if (text) el.setAttribute('style', text);
    else el.removeAttribute('style');
  };
  const set = (name: string, value: unknown) => {
    const v = str(value);
    if (v === '') decls.delete(name);
    else decls.set(name, v);
  };
  const api = {
    setProperty(name: string, value: string | null) {
      set(kebab(name), value);
      write();
    },
    removeProperty(name: string) {
      const old = decls.get(kebab(name)) ?? '';
      decls.delete(kebab(name));
      write();
      return old;
    },
    getPropertyValue(name: string) {
      return decls.get(kebab(name)) ?? '';
    },
    get cssText() {
      return [...decls].map(([k, v]) => `${k}: ${v};`).join(' ');
    },
    set cssText(text: string) {
      decls.clear();
      for (const part of text.split(';')) {
        const i = part.indexOf(':');
        if (i > 0) set(part.slice(0, i).trim(), part.slice(i + 1).trim());
      }
      write();
    },
  };
  return new Proxy(api, {
    get(t, key, receiver) {
      if (typeof key !== 'string' || key in t) return Reflect.get(t, key, receiver) as unknown;
      return decls.get(kebab(key === 'cssFloat' ? 'float' : key)) ?? '';
    },
    set(t, key, value, receiver) {
      if (typeof key !== 'string' || key in t) return Reflect.set(t, key, value, receiver);
      set(kebab(key === 'cssFloat' ? 'float' : key), value);
      write();
      return true;
    },
  });
}

/**
 * `element.classList` (DOM group 1, ADR 0010): a view of the `class`
 * attribute, so every write travels as an `attr` record.
 */
export class WDOMTokenList {
  /** @internal */ readonly isoEl: WElement;

  constructor(el: WElement) {
    this.isoEl = el;
  }

  /** @internal */ isoTokens(): string[] {
    const tokens: string[] = [];
    for (const t of (this.isoEl.getAttribute('class') ?? '').split(/[\t\n\f\r ]+/)) {
      if (t !== '' && !tokens.includes(t)) tokens.push(t);
    }
    return tokens;
  }

  /** @internal */ isoWrite(tokens: string[]): void {
    this.isoEl.setAttribute('class', tokens.join(' '));
  }

  get length(): number {
    return this.isoTokens().length;
  }
  get value(): string {
    return this.isoEl.getAttribute('class') ?? '';
  }
  set value(v: string) {
    this.isoEl.setAttribute('class', v);
  }
  item(i: number): string | null {
    return this.isoTokens()[i] ?? null;
  }
  contains(token: string): boolean {
    return this.isoTokens().includes(token);
  }
  add(...tokens: string[]): void {
    const list = this.isoTokens();
    for (const t of tokens) if (!list.includes(t)) list.push(t);
    this.isoWrite(list);
  }
  remove(...tokens: string[]): void {
    this.isoWrite(this.isoTokens().filter((t) => !tokens.includes(t)));
  }
  toggle(token: string, force?: boolean): boolean {
    const has = this.contains(token);
    const on = force ?? !has;
    if (on && !has) this.add(token);
    else if (!on && has) this.remove(token);
    return on;
  }
  replace(token: string, next: string): boolean {
    const list = this.isoTokens();
    const i = list.indexOf(token);
    if (i < 0) return false;
    list[i] = next;
    this.isoWrite(list.filter((t, j) => list.indexOf(t) === j));
    return true;
  }
  toString(): string {
    return this.value;
  }
  [Symbol.iterator](): IterableIterator<string> {
    return this.isoTokens()[Symbol.iterator]();
  }
}

const dataAttr = (key: string): string =>
  `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const dataKey = (attr: string): string =>
  attr.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * `element.dataset` (DOM group 1, ADR 0010): camelCase keys over the
 * `data-*` attributes, so every write travels as an `attr` record.
 */
function createDataset(el: WElement): Record<string, string | undefined> {
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        typeof key === 'string' ? (el.getAttribute(dataAttr(key)) ?? undefined) : undefined,
      set(_t, key, value) {
        if (typeof key !== 'string') return false;
        el.setAttribute(dataAttr(key), value);
        return true;
      },
      deleteProperty(_t, key) {
        if (typeof key === 'string') el.removeAttribute(dataAttr(key));
        return true;
      },
      has: (_t, key) => typeof key === 'string' && el.hasAttribute(dataAttr(key)),
      ownKeys: () => [...el.isoAttrs.keys()].filter((n) => n.startsWith('data-')).map(dataKey),
      getOwnPropertyDescriptor(_t, key) {
        if (typeof key !== 'string' || !el.hasAttribute(dataAttr(key))) return undefined;
        return {
          value: el.getAttribute(dataAttr(key)),
          writable: true,
          enumerable: true,
          configurable: true,
        };
      },
    },
  );
}

/**
 * What elements and fragments share: an ordered child list. Changes under a
 * known parent become records; a fragment is never known.
 */
export abstract class WParentNode extends WNode {
  /** @internal */ isoFirst: WNode | null = null;
  /** @internal */ isoLast: WNode | null = null;
  /** @internal */ isoChildCache: WNode[] | null = null;

  override get firstChild(): WNode | null {
    return this.isoFirst;
  }
  override get lastChild(): WNode | null {
    return this.isoLast;
  }
  override get childNodes(): readonly WNode[] {
    if (!this.isoChildCache) {
      const list: WNode[] = [];
      for (let n = this.isoFirst; n; n = n.isoNext) list.push(n);
      this.isoChildCache = list;
    }
    return this.isoChildCache;
  }
  get children(): readonly WElement[] {
    return this.childNodes.filter((n): n is WElement => n instanceof WElement);
  }
  get firstElementChild(): WElement | null {
    return this.children[0] ?? null;
  }

  /** Text of the subtree; comments don't count, as in the DOM. */
  get textContent(): string {
    let out = '';
    for (let n = this.isoFirst; n; n = n.isoNext)
      if (!(n instanceof WComment)) out += n.textContent;
    return out;
  }
  set textContent(v: string | null) {
    this.replaceChildren(...(v ? [this.ownerDocument.createTextNode(v)] : []));
  }

  appendChild<T extends WNode>(child: T): T {
    return this.insertBefore(child, null);
  }

  insertBefore<T extends WNode>(child: T, ref: WNode | null): T {
    if (!(child instanceof WNode)) throw new TypeError('insertBefore: not a node');
    if (ref && ref.isoParent !== this) {
      throw domError('NotFoundError', 'insertBefore: the reference node is not a child');
    }
    if (child.contains(this)) {
      throw domError('HierarchyRequestError', 'insertBefore: would create a cycle');
    }
    if (ref === child) ref = child.isoNext;
    // A fragment's children move in, in order, and leave it empty (DOM group 1).
    if (child instanceof WDocumentFragment) {
      // `childNodes` is a snapshot: moving a child builds a new one.
      for (const c of child.childNodes) this.insertBefore(c, ref);
      return child;
    }
    if (this.ownerDocument.head === (this as WParentNode) && child instanceof WElement) {
      this.ownerDocument.isoCore.onHead(child.localName);
    }
    const wasKnown = child.isoKnown;
    child.isoParent?.isoUnlink(child);
    this.isoLink(child, ref);
    const core = this.ownerDocument.isoCore;
    if (wasKnown && this.isoKnown)
      core.record(['move', this.isoId, child.isoId, ref?.isoId ?? null]);
    else if (wasKnown) {
      core.record(['remove', child.isoId]);
      forget(child, core);
    } else if (this.isoKnown) {
      core.record(['insert', this.isoId, serialize(child), ref?.isoId ?? null]);
      learn(child, core);
    }
    return child;
  }

  removeChild<T extends WNode>(child: T): T {
    if (child.isoParent !== this) throw domError('NotFoundError', 'removeChild: not a child');
    this.isoUnlink(child);
    if (child.isoKnown) {
      const core = this.ownerDocument.isoCore;
      core.record(['remove', child.isoId]);
      forget(child, core);
    }
    return child;
  }

  replaceChildren(...nodes: (WNode | string)[]): void {
    while (this.isoLast) this.removeChild(this.isoLast);
    this.append(...nodes);
  }

  append(...nodes: (WNode | string)[]): void {
    for (const n of nodes) {
      this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n);
    }
  }

  /** @internal */ isoUnlink(child: WNode): void {
    if (child.isoPrev) child.isoPrev.isoNext = child.isoNext;
    else this.isoFirst = child.isoNext;
    if (child.isoNext) child.isoNext.isoPrev = child.isoPrev;
    else this.isoLast = child.isoPrev;
    child.isoParent = null;
    child.isoPrev = null;
    child.isoNext = null;
    this.isoChildCache = null;
  }

  /** @internal */ isoLink(child: WNode, ref: WNode | null): void {
    child.isoParent = this;
    child.isoNext = ref;
    child.isoPrev = ref ? ref.isoPrev : this.isoLast;
    if (child.isoPrev) child.isoPrev.isoNext = child;
    else this.isoFirst = child;
    if (ref) ref.isoPrev = child;
    else this.isoLast = child;
    this.isoChildCache = null;
  }
}

/**
 * `DocumentFragment` (DOM group 1, ADR 0010): a detached holder. Inserting
 * it inserts its children, in order, and empties it; it never reaches the
 * host itself.
 */
export class WDocumentFragment extends WParentNode {
  readonly nodeType = 11;
  readonly nodeName = '#document-fragment';
  get nodeValue(): string | null {
    return null;
  }
  set nodeValue(_v: string | null) {}
}

export class WElement extends WParentNode {
  readonly nodeType = 1;
  readonly localName: string;
  readonly namespaceURI: string;
  /** @internal */ readonly isoNs: Namespace;
  /** @internal */ isoAttrs: Map<string, string> = new Map();
  /** @internal */ isoProps: Map<SyncedProp, string | boolean> = new Map();
  /** @internal */ isoStyle: WStyle | null = null;
  /** @internal */ isoClassList: WDOMTokenList | null = null;
  /** @internal */ isoDataset: Record<string, string | undefined> | null = null;
  /** @internal The offsets the last `scroll` event brought (design §4.6). */
  isoScroll = { top: 0, left: 0 };

  constructor(doc: WDocument, id: NodeId, localName: string, ns: Namespace) {
    super(doc, id);
    this.localName = localName;
    this.isoNs = ns;
    this.namespaceURI = ns === 'svg' ? SVG_NS : HTML_NS;
  }

  get tagName(): string {
    return this.isoNs === 'html' ? this.localName.toUpperCase() : this.localName;
  }
  get nodeName(): string {
    return this.tagName;
  }
  get nodeValue(): string | null {
    return null;
  }
  set nodeValue(_v: string | null) {}

  get attributes(): readonly { name: string; value: string }[] {
    return [...this.isoAttrs].map(([name, value]) => ({ name, value }));
  }
  getAttribute(name: string): string | null {
    return this.isoAttrs.get(this.isoAttrName(name)) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.isoAttrs.has(this.isoAttrName(name));
  }
  setAttribute(name: string, value: unknown): void {
    const n = this.isoAttrName(name);
    const v = str(value);
    if (this.isoAttrs.get(n) === v) return;
    this.isoAttrs.set(n, v);
    if (this.isoKnown) this.ownerDocument.isoCore.record(['attr', this.isoId, n, v]);
  }
  removeAttribute(name: string): void {
    const n = this.isoAttrName(name);
    if (!this.isoAttrs.delete(n)) return;
    if (this.isoKnown) this.ownerDocument.isoCore.record(['attr', this.isoId, n, null]);
  }
  /** @internal HTML attribute names are case-insensitive; SVG ones aren't. */
  isoAttrName(name: string): string {
    return this.isoNs === 'html' ? name.toLowerCase() : name;
  }

  get style(): WStyle {
    this.isoStyle ??= createStyle(this);
    return this.isoStyle;
  }

  get classList(): WDOMTokenList {
    this.isoClassList ??= new WDOMTokenList(this);
    return this.isoClassList;
  }

  get dataset(): Record<string, string | undefined> {
    this.isoDataset ??= createDataset(this);
    return this.isoDataset;
  }

  /**
   * Read only, and as of the last `scroll` event the element got: the host
   * owns scrolling. 0 until the element is scrolled and listens for `scroll`.
   */
  get scrollTop(): number {
    return this.isoScroll.top;
  }
  get scrollLeft(): number {
    return this.isoScroll.left;
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }
  set id(v: string) {
    this.setAttribute('id', v);
  }

  /** @internal */ isoSetProp(name: SyncedProp, value: string | boolean, record: boolean): void {
    if (this.isoProps.get(name) === value) return;
    this.isoProps.set(name, value);
    if (record && this.isoKnown)
      this.ownerDocument.isoCore.record(['prop', this.isoId, name, value]);
  }
}

/**
 * Event handler properties (`onclick`…), as in the DOM's GlobalEventHandlers.
 * Frameworks check `'oninput' in document` and `'onclick' in el` to learn
 * event names (React's input events, Preact 10's lowercasing); setting one
 * adds the handler as a listener, as in the DOM.
 */
const HANDLER_EVENTS = [
  'abort',
  'animationend',
  'animationiteration',
  'animationstart',
  'auxclick',
  'beforeinput',
  'blur',
  'cancel',
  'change',
  'click',
  'close',
  'contextmenu',
  'copy',
  'cut',
  'dblclick',
  'drag',
  'dragend',
  'dragenter',
  'dragleave',
  'dragover',
  'dragstart',
  'drop',
  'error',
  'focus',
  'input',
  'invalid',
  'keydown',
  'keypress',
  'keyup',
  'load',
  'mousedown',
  'mouseenter',
  'mouseleave',
  'mousemove',
  'mouseout',
  'mouseover',
  'mouseup',
  'paste',
  'pointercancel',
  'pointerdown',
  'pointerenter',
  'pointerleave',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
  'reset',
  'resize',
  'scroll',
  'select',
  'submit',
  'toggle',
  'touchcancel',
  'touchend',
  'touchmove',
  'touchstart',
  'transitionend',
  'wheel',
];

function defineHandlers(proto: WEventTarget): void {
  const handlers = new WeakMap<WEventTarget, Map<string, ListenerFn>>();
  for (const type of HANDLER_EVENTS) {
    Object.defineProperty(proto, `on${type}`, {
      configurable: true,
      enumerable: true,
      get(this: WEventTarget): ListenerFn | null {
        return handlers.get(this)?.get(type) ?? null;
      },
      set(this: WEventTarget, fn: unknown) {
        const own = handlers.get(this) ?? new Map<string, ListenerFn>();
        handlers.set(this, own);
        const old = own.get(type);
        if (old) this.removeEventListener(type, old);
        if (typeof fn === 'function') {
          const handler: ListenerFn = (e) => {
            Reflect.apply(fn, this, [e]);
          };
          own.set(type, handler);
          this.addEventListener(type, handler);
        } else own.delete(type);
      },
    });
  }
}

defineHandlers(WElement.prototype);

export class WHTMLElement extends WElement {}
export class WSVGElement extends WElement {}
/** Only for `instanceof` checks; never created by the host (the registry drops iframes). */
export class WHTMLIFrameElement extends WHTMLElement {}

export class WHTMLInputElement extends WHTMLElement {
  get value(): string {
    const v = this.isoProps.get('value');
    return typeof v === 'string' ? v : (this.getAttribute('value') ?? '');
  }
  set value(v: unknown) {
    this.isoSetProp('value', str(v), true);
  }
  get checked(): boolean {
    const v = this.isoProps.get('checked');
    return typeof v === 'boolean' ? v : this.hasAttribute('checked');
  }
  set checked(v: unknown) {
    this.isoSetProp('checked', Boolean(v), true);
  }
  get defaultValue(): string {
    return this.getAttribute('value') ?? '';
  }
  set defaultValue(v: string) {
    this.setAttribute('value', v);
  }
  get defaultChecked(): boolean {
    return this.hasAttribute('checked');
  }
  set defaultChecked(v: boolean) {
    if (v) this.setAttribute('checked', '');
    else this.removeAttribute('checked');
  }
  get name(): string {
    return this.getAttribute('name') ?? '';
  }
  set name(v: string) {
    this.setAttribute('name', v);
  }
  get type(): string {
    return this.getAttribute('type') ?? 'text';
  }
  set type(v: string) {
    this.setAttribute('type', v);
  }
}

export class WHTMLTextAreaElement extends WHTMLElement {
  get value(): string {
    const v = this.isoProps.get('value');
    return typeof v === 'string' ? v : this.textContent;
  }
  set value(v: unknown) {
    this.isoSetProp('value', str(v), true);
  }
  get defaultValue(): string {
    return this.textContent;
  }
  set defaultValue(v: string) {
    this.textContent = v;
  }
  get name(): string {
    return this.getAttribute('name') ?? '';
  }
  set name(v: string) {
    this.setAttribute('name', v);
  }
}

export class WHTMLSelectElement extends WHTMLElement {
  /** The `<option>`s under the select, `<optgroup>`s included, in tree order. React walks it. */
  get options(): readonly WHTMLOptionElement[] {
    const out: WHTMLOptionElement[] = [];
    const walk = (el: WElement) => {
      for (const c of el.children) {
        if (c instanceof WHTMLOptionElement) out.push(c);
        else if (c.localName === 'optgroup') walk(c);
      }
    };
    walk(this);
    return out;
  }
  get multiple(): boolean {
    return this.hasAttribute('multiple');
  }
  set multiple(v: unknown) {
    if (v) this.setAttribute('multiple', '');
    else this.removeAttribute('multiple');
  }
  get value(): string {
    const v = this.isoProps.get('value');
    return typeof v === 'string' ? v : '';
  }
  set value(v: unknown) {
    this.isoSetProp('value', str(v), true);
  }
  get name(): string {
    return this.getAttribute('name') ?? '';
  }
  set name(v: string) {
    this.setAttribute('name', v);
  }
}

export class WHTMLOptionElement extends WHTMLElement {
  /** The `value` attribute, or the text when there's none, as in the DOM. */
  get value(): string {
    return this.getAttribute('value') ?? this.textContent;
  }
  set value(v: unknown) {
    this.setAttribute('value', v);
  }
  get selected(): boolean {
    const v = this.isoProps.get('selected');
    return typeof v === 'boolean' ? v : this.hasAttribute('selected');
  }
  set selected(v: unknown) {
    this.isoSetProp('selected', Boolean(v), true);
  }
  get defaultSelected(): boolean {
    return this.hasAttribute('selected');
  }
  set defaultSelected(v: unknown) {
    if (v) this.setAttribute('selected', '');
    else this.removeAttribute('selected');
  }
  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(v: unknown) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }
}

const HTML_CLASSES: Record<
  string,
  new (doc: WDocument, id: NodeId, tag: string, ns: Namespace) => WElement
> = {
  input: WHTMLInputElement,
  textarea: WHTMLTextAreaElement,
  select: WHTMLSelectElement,
  option: WHTMLOptionElement,
  iframe: WHTMLIFrameElement,
};

export class WDocument extends WEventTarget {
  readonly nodeType = 9;
  readonly nodeName = '#document';
  /** @internal */ readonly isoCore: Core;
  /** Set by `install()`: the worker global. */
  defaultView: unknown = null;
  readonly activeElement = null;
  /** `null`, as for every document. */
  readonly ownerDocument = null;
  /** A detached body, for code that falls back to `document.body`. */
  readonly body: WHTMLElement;
  /**
   * A detached head: React 19 hoists `<title>`, `<meta>` and `<link>` into
   * it. The bridge doesn't render it (M3a task 3).
   */
  readonly head: WHTMLElement;

  constructor(core: Core) {
    super();
    this.isoCore = core;
    this.body = new WHTMLElement(this, -1, 'body', 'html');
    this.head = new WHTMLElement(this, -2, 'head', 'html');
  }

  createElement(tag: string): WElement {
    const t = tag.toLowerCase();
    const C = Object.hasOwn(HTML_CLASSES, t) ? HTML_CLASSES[t] : undefined;
    return new (C ?? WHTMLElement)(this, this.isoCore.nextId++, t, 'html');
  }

  createElementNS(ns: string | null, tag: string): WElement {
    if (ns === SVG_NS) return new WSVGElement(this, this.isoCore.nextId++, tag, 'svg');
    if (ns === HTML_NS || ns === null) return this.createElement(tag);
    throw domError('NotSupportedError', `createElementNS: namespace ${ns} isn't supported`);
  }

  /** `data` is converted with `String()`, as in the DOM: Preact passes numbers. */
  createTextNode(data: unknown): WText {
    return new WText(this, this.isoCore.nextId++, String(data));
  }

  createComment(data: unknown): WComment {
    return new WComment(this, this.isoCore.nextId++, String(data));
  }

  /** Fragments never reach the host, so they take no id from the shared counter. */
  createDocumentFragment(): WDocumentFragment {
    return new WDocumentFragment(this, -3);
  }

  /**
   * The first element in tree order with this `id` (DOM group 1, ADR 0010):
   * under the render root, then the detached head. Nodes not yet inserted
   * aren't in the document, so they aren't found.
   */
  getElementById(id: string): WElement | null {
    const walk = (el: WElement): WElement | null => {
      for (const c of el.children) {
        if (c.getAttribute('id') === id) return c;
        const deeper = walk(c);
        if (deeper) return deeper;
      }
      return null;
    };
    const root = this.isoCore.root;
    return (root ? walk(root) : null) ?? walk(this.head);
  }

  /**
   * Type selectors only, alone or as a `head > title` child chain: what React
   * 19 asks when it hoists a `<title>`. Queries in general are DOM group 2
   * (ADR 0010), built when a library needs them; anything else throws.
   */
  querySelector(selector: string): WElement | null {
    const steps = selector.split('>').map((t) => t.trim().toLowerCase());
    if (!steps.every((t) => /^[a-z][a-z0-9-]*$/.test(t))) {
      throw domError('NotSupportedError', `querySelector: "${selector}" isn't supported yet`);
    }
    const matches = (el: WElement): boolean => {
      let n: WElement | null = el;
      for (let i = steps.length - 1; i >= 0; i--) {
        if (!n || n.localName !== steps[i]) return false;
        n = i > 0 ? n.parentElement : null;
      }
      return true;
    };
    const walk = (el: WElement): WElement | null => {
      for (const c of el.children) {
        if (matches(c)) return c;
        const deeper = walk(c);
        if (deeper) return deeper;
      }
      return null;
    };
    for (const top of [this.head, this.body]) {
      if (matches(top)) return top;
      const hit = walk(top);
      if (hit) return hit;
    }
    return null;
  }
}

defineHandlers(WDocument.prototype);

/** The subtree as `insert` sends it. */
function serialize(n: WNode): SerializedNode {
  if (n instanceof WText) return { k: 'text', id: n.isoId, data: n.isoData };
  if (n instanceof WComment) return { k: 'comment', id: n.isoId, data: n.isoData };
  if (!(n instanceof WElement)) throw new TypeError('serialize: unknown node');
  return {
    k: 'el',
    id: n.isoId,
    tag: n.localName,
    ns: n.isoNs,
    attrs: [...n.isoAttrs],
    props: [...n.isoProps],
    listen: [...n.isoListeners.keys()],
    children: n.childNodes.map(serialize),
  };
}

function learn(n: WNode, core: Core): void {
  n.isoKnown = true;
  core.known.set(n.isoId, n);
  for (const c of n.childNodes) learn(c, core);
}

function forget(n: WNode, core: Core): void {
  n.isoKnown = false;
  core.known.delete(n.isoId);
  for (const c of n.childNodes) forget(c, core);
}

export type WorkerDomOptions = {
  /** Receives each batch, in order. */
  onBatch(batch: DomBatch): void;
  /** Called once per batch with the flush to run; default `queueMicrotask`. */
  schedule?: (flush: () => void) => void;
  /**
   * An element was inserted into `document.head` (React 19 hoists `<title>`,
   * `<meta>` and `<link>` there). The bridge doesn't render the head; the
   * runtime tells the host, which warns in `dev` (M3a task 3).
   */
  onHead?: (tag: string) => void;
};

export interface WorkerDom {
  readonly document: WDocument;
  /** The isolate's render root; the host maps it to the surface. */
  readonly root: WElement;
  /** Sends pending records now, if any. */
  flush(): void;
  /** Dispatches an event from the host to the node it names (capture and bubble in the worker). */
  deliver(event: DomEvent): void;
  /** The id of a node, for tests and host calls. */
  idOf(node: WNode): NodeId;
  /**
   * Sets an input's, textarea's or select's `value`. With `force`, the host
   * applies it even while the user is focused on a host-owned input, and
   * keeps the caret at its end; it's recorded even if the worker already
   * holds that value, since what the user typed may differ (M3a task 6).
   */
  setValue(node: WNode, value: string, opts?: { force?: boolean }): void;
}

export function createDom(opts: WorkerDomOptions): WorkerDom {
  const schedule = opts.schedule ?? ((fn: () => void) => queueMicrotask(fn));
  let pending: DomRecord[] = [];
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    opts.onBatch(batch);
  };
  const core: Core = {
    root: null,
    nextId: ROOT_ID + 1,
    known: new Map(),
    onHead: opts.onHead ?? (() => {}),
    record(r) {
      pending.push(r);
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },
  };
  const document = new WDocument(core);
  const root = new WHTMLElement(document, ROOT_ID, 'iso-root', 'html');
  root.isoKnown = true;
  core.known.set(ROOT_ID, root);
  core.root = root;

  return {
    document,
    root,
    flush,
    idOf: (node) => node.isoId,
    setValue(node, value, o = {}) {
      const control =
        node instanceof WHTMLInputElement ||
        node instanceof WHTMLTextAreaElement ||
        node instanceof WHTMLSelectElement;
      if (!control) throw new TypeError('setValue: not an input, textarea or select');
      if (!o.force) {
        node.value = value;
        return;
      }
      node.isoSetProp('value', value, false);
      if (node.isoKnown) core.record(['prop', node.isoId, 'value', value, true]);
    },
    deliver(event) {
      const node = core.known.get(event.target);
      if (!node) return;
      // The host already shows what the user typed; sync it without echoing a record.
      const control =
        node instanceof WHTMLInputElement ||
        node instanceof WHTMLTextAreaElement ||
        node instanceof WHTMLSelectElement;
      if (control && event.value !== undefined) node.isoSetProp('value', event.value, false);
      if (node instanceof WHTMLInputElement && event.checked !== undefined)
        node.isoSetProp('checked', event.checked, false);
      if (event.type === 'scroll' && node instanceof WElement) {
        node.isoScroll = { top: event.scrollTop ?? 0, left: event.scrollLeft ?? 0 };
      }
      node.dispatchEvent(toEvent(event));
    },
  };
}

/** A real `Event` with the fields frameworks read from mouse and keyboard events. */
function toEvent(e: DomEvent): Event {
  // `scroll` doesn't bubble, as in the DOM.
  const ev = new Event(e.type, { bubbles: e.type !== 'scroll', cancelable: true });
  const mods: Record<string, boolean> = {
    Alt: e.mods.alt,
    Control: e.mods.ctrl,
    Meta: e.mods.meta,
    Shift: e.mods.shift,
  };
  // `isTrusted` stays false: it's an unforgeable own property of every Event.
  Object.defineProperties(ev, {
    altKey: { value: e.mods.alt },
    ctrlKey: { value: e.mods.ctrl },
    metaKey: { value: e.mods.meta },
    shiftKey: { value: e.mods.shift },
    getModifierState: { value: (k: string) => mods[k] ?? false },
    key: { value: e.key },
    code: { value: e.code },
    button: { value: e.button ?? 0 },
    clientX: { value: e.x ?? 0 },
    clientY: { value: e.y ?? 0 },
    // `resize` on a transferred canvas (design §4.7).
    width: { value: e.width },
    height: { value: e.height },
  });
  return ev;
}
