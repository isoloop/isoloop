/*
 * The bridge conformance suite (ADR 0010 point 6, ADR 0011): every render
 * bridge must pass it. It knows bridges only through the structural types
 * below, so it imports nothing from other Isoloop packages.
 */
import { afterEach, describe, expect, it } from 'vitest';

/** An event as a host bridge sends it to the isolate, reduced to what the suite reads. */
export type ConformanceEvent = {
  type: string;
  target: string;
  currentTargets: string[];
  value?: string;
  mods: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
};

/** The host side of a bridge, as the compositor drives it. */
export interface ConformanceHost {
  mount(root: ShadowRoot, send: (event: ConformanceEvent) => void): void;
  /** Applies one batch. Returns false and changes nothing if the batch is malformed. */
  apply(batch: unknown): boolean;
  unmount(): void;
}

/** A node on the isolate side, as the suite sees it. Opaque to the suite. */
export type Handle = { readonly __handle: true };

/**
 * The isolate side of a bridge, reduced to the DOM operations the suite needs.
 * Each bridge provides its own: the isoloop-dom driver calls the worker-side
 * DOM subset, the legacy-vdom driver keeps a tree and sends it whole.
 */
export interface IsolateDriver {
  /** An element with `class="cf-root"` that the suite builds under. Already inserted. */
  readonly root: Handle;
  el(tag: string): Handle;
  text(data: string): Handle;
  /** Inserts `child` into `parent` before `before`, or at the end. Moves it if it's already in the tree. */
  insert(parent: Handle, child: Handle, before?: Handle | null): void;
  remove(child: Handle): void;
  /** `null` removes the attribute. */
  setAttr(el: Handle, name: string, value: string | null): void;
  setText(text: Handle, data: string): void;
  /** Sets the `value` property, as a framework does on a controlled input. */
  setValue(el: Handle, value: string): void;
  listen(el: Handle, type: string): void;
  /** The batches produced since the last flush, in order. */
  flush(): unknown[];
  /** The node id the isolate side uses for `h`, for bridges that expose ids. */
  idOf(h: Handle): string;
  /** The handle an event's `target` or `currentTargets` entry names. */
  handleFor(nodeId: string): Handle | undefined;
}

/** Host-side node-id lookups (design §4.5). Optional until every bridge has them. */
export interface NodeIds {
  idFor(node: Node): string | undefined;
  nodeFor(id: string): Element | undefined;
}

export interface BridgePair {
  host: ConformanceHost & Partial<NodeIds>;
  isolate: IsolateDriver;
  /** Attributes the bridge writes for its own bookkeeping, left out when trees are compared. */
  internalAttr?: (name: string) => boolean;
}

export type MakeBridgePair = () => BridgePair;

/** Cases a bridge may declare as known gaps; they run as expected failures. */
export const CASES = {
  create: 'creates elements, attributes and text',
  update: 'updates attributes and text, and removes attributes',
  move: 'moves a node',
  remove: 'removes nodes',
  keyed: 'keyed list reorders keep node identity and focus',
  sanitise: 'sanitises tags, attributes and URLs (I9)',
  ids: 'maps node ids both ways',
  events: 'registers listeners and round-trips events',
  noListener: 'sends nothing for a node without a listener',
  inputs: 'host-owned inputs keep the live value while focused',
  styles: 'applies inline styles',
  malformed: 'rejects a malformed batch and keeps the tree',
} as const;

export type CaseName = keyof typeof CASES;

/**
 * The suite every render bridge must pass: `legacy-vdom` (with its known
 * gaps), the isoloop-dom bridge (with none), and any bridge after them. Batches go
 * through `structuredClone`, as they would through `postMessage`.
 */
export function runBridgeConformance(
  name: string,
  makePair: MakeBridgePair,
  opts: { knownGaps?: readonly CaseName[] } = {},
): void {
  const gaps = new Set(opts.knownGaps ?? []);
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const off of cleanups.splice(0)) off();
  });

  const setup = () => {
    const { host, isolate, internalAttr = () => false } = makePair();
    const shadowHost = document.createElement('div');
    document.body.append(shadowHost);
    const shadow = shadowHost.attachShadow({ mode: 'open' });
    const sent: ConformanceEvent[] = [];
    host.mount(shadow, (e) => sent.push(e));
    cleanups.push(() => {
      host.unmount();
      shadowHost.remove();
    });
    const sync = () => {
      for (const batch of isolate.flush()) expect(host.apply(structuredClone(batch))).toBe(true);
    };
    sync();
    const root = (): Element => {
      const el = shadow.querySelector('.cf-root');
      if (!el) throw new Error('no .cf-root on the host');
      return el;
    };
    const html = () => serialize(root(), internalAttr);
    const find = (selector: string): Element => {
      const el = root().querySelector(selector);
      if (!el) throw new Error(`no ${selector} on the host`);
      return el;
    };
    return { host, isolate, shadow, sent, sync, root, html, find };
  };

  const test = (key: CaseName, fn: () => void) =>
    gaps.has(key) ? it.fails(`${CASES[key]} (known gap)`, fn) : it(CASES[key], fn);

  describe(`render bridge conformance: ${name}`, () => {
    test('create', () => {
      const { isolate: d, sync, html } = setup();
      const p = build(d, 'p', ['hello ', build(d, 'strong', ['world'])]);
      d.setAttr(p, 'class', 'greeting');
      d.setAttr(p, 'title', 'Hi');
      d.insert(d.root, p);
      d.insert(d.root, build(d, 'ul', [build(d, 'li', ['a']), build(d, 'li', ['b'])]));
      sync();
      expect(html()).toBe(
        '<p class="greeting" title="Hi">hello <strong>world</strong></p><ul><li>a</li><li>b</li></ul>',
      );
    });

    test('update', () => {
      const { isolate: d, sync, html } = setup();
      const t = d.text('one');
      const span = build(d, 'span', [t]);
      d.setAttr(span, 'class', 'a');
      d.setAttr(span, 'title', 'x');
      d.insert(d.root, span);
      sync();
      d.setText(t, 'two');
      d.setAttr(span, 'class', 'b');
      d.setAttr(span, 'title', null);
      sync();
      expect(html()).toBe('<span class="b">two</span>');
    });

    test('move', () => {
      const { isolate: d, sync, html } = setup();
      const a = build(d, 'span', ['a']);
      const b = build(d, 'span', ['b']);
      const c = build(d, 'span', ['c']);
      for (const x of [a, b, c]) d.insert(d.root, x);
      sync();
      d.insert(d.root, c, a);
      sync();
      expect(html()).toBe('<span>c</span><span>a</span><span>b</span>');
    });

    test('remove', () => {
      const { isolate: d, sync, html } = setup();
      const t = d.text('gone');
      const keep = build(d, 'p', ['kept', t]);
      const drop = build(d, 'p', ['dropped']);
      d.insert(d.root, keep);
      d.insert(d.root, drop);
      sync();
      d.remove(drop);
      d.remove(t);
      sync();
      expect(html()).toBe('<p>kept</p>');
    });

    test('keyed', () => {
      const { isolate: d, sync, root, shadow } = setup();
      const ul = d.el('ul');
      const items = ['a', 'b', 'c'].map((k) => {
        const input = d.el('input');
        d.setAttr(input, 'title', k);
        return build(d, 'li', [k, input]);
      });
      for (const li of items) d.insert(ul, li);
      d.insert(d.root, ul);
      sync();
      const before = [...root().querySelectorAll('li')];
      const input = before[2]?.querySelector('input');
      if (!(input instanceof HTMLInputElement)) throw new Error('no input');
      input.focus();
      expect(shadow.activeElement).toBe(input);
      const [first, , last] = items;
      if (!first || !last) throw new Error('no items');
      d.insert(ul, last, first);
      sync();
      const after = [...root().querySelectorAll('li')];
      expect(after.map((li) => li.textContent)).toEqual(['c', 'a', 'b']);
      expect(after[0]).toBe(before[2]);
      expect(shadow.activeElement).toBe(input);
    });

    test('sanitise', () => {
      const { isolate: d, sync, root } = setup();
      const tags = ['script', 'iframe', 'object', 'embed', 'style', 'made-up'];
      for (const tag of tags) d.insert(d.root, build(d, tag, [tag]));
      const a = build(d, 'a', ['link']);
      d.setAttr(a, 'href', 'javascript:alert(1)');
      d.setAttr(a, 'onclick', 'alert(1)');
      d.insert(d.root, a);
      const div = d.el('div');
      d.setAttr(div, 'srcdoc', '<script>alert(1)</script>');
      d.setAttr(div, 'onmouseover', 'alert(1)');
      d.insert(d.root, div);
      sync();
      const all = [...root().querySelectorAll('*')];
      for (const tag of ['script', 'iframe', 'object', 'embed', 'style', 'made-up']) {
        expect(root().querySelector(tag)).toBeNull();
      }
      for (const el of all) {
        for (const attr of el.attributes) {
          expect(attr.name.startsWith('on'), `${el.localName}[${attr.name}]`).toBe(false);
          expect(attr.name).not.toBe('srcdoc');
          expect(attr.value.trim().toLowerCase().startsWith('javascript:')).toBe(false);
        }
      }
      // Unknown and forbidden tags keep their content, as a div.
      expect([...root().children].map((el) => el.textContent).slice(0, tags.length)).toEqual(tags);
    });

    test('ids', () => {
      const { host, isolate: d, sync, find } = setup();
      const button = build(d, 'button', ['ok']);
      d.insert(d.root, button);
      sync();
      if (!host.idFor || !host.nodeFor) throw new Error('bridge has no idFor/nodeFor');
      const el = find('button');
      const id = d.idOf(button);
      expect(host.nodeFor(id)).toBe(el);
      expect(host.idFor(el)).toBe(id);
      expect(host.nodeFor('no-such-id')).toBeUndefined();
    });

    test('events', () => {
      const { isolate: d, sync, sent, find } = setup();
      const button = build(d, 'button', [build(d, 'span', ['go'])]);
      d.listen(button, 'click');
      d.insert(d.root, button);
      const input = d.el('input');
      d.listen(input, 'input');
      d.insert(d.root, input);
      sync();
      find('button span').dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true }),
      );
      const el = find('input');
      if (!(el instanceof HTMLInputElement)) throw new Error('no input');
      el.value = 'hi';
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      const [click, typed] = sent;
      expect(sent).toHaveLength(2);
      expect(click?.type).toBe('click');
      expect(click?.mods.shift).toBe(true);
      expect(click?.currentTargets.map((id) => d.handleFor(id))).toContain(button);
      expect(typed?.type).toBe('input');
      expect(typed?.value).toBe('hi');
      expect(d.handleFor(typed?.target ?? '')).toBe(input);
    });

    test('noListener', () => {
      const { isolate: d, sync, sent, find } = setup();
      d.insert(d.root, build(d, 'button', ['nothing']));
      sync();
      find('button').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      expect(sent).toEqual([]);
    });

    test('inputs', () => {
      const { isolate: d, sync, find } = setup();
      const input = d.el('input');
      d.listen(input, 'input');
      d.insert(d.root, input);
      sync();
      const el = find('input');
      if (!(el instanceof HTMLInputElement)) throw new Error('no input');
      el.focus();
      el.value = 'typed';
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      // A stale value from the isolate never overwrites what the user is typing.
      d.setValue(input, 'stale');
      sync();
      expect(el.value).toBe('typed');
      el.blur();
      d.setValue(input, 'next');
      sync();
      expect(el.value).toBe('next');
    });

    test('styles', () => {
      const { isolate: d, sync, find } = setup();
      const p = build(d, 'p', ['red']);
      d.setAttr(p, 'style', 'color: red');
      d.insert(d.root, p);
      sync();
      const el = find('p');
      if (!(el instanceof HTMLElement)) throw new Error('no p');
      expect(el.style.color).toBe('red');
    });

    test('malformed', () => {
      const { host, isolate: d, sync, html } = setup();
      d.insert(d.root, build(d, 'p', ['ok']));
      sync();
      for (const bad of [null, 'x', 42, { nonsense: true }, [[99, 'nope']]]) {
        expect(host.apply(bad)).toBe(false);
      }
      expect(html()).toBe('<p>ok</p>');
    });
  });
}

/** An element with text and element children, built through the driver. */
function build(d: IsolateDriver, tag: string, children: (Handle | string)[] = []): Handle {
  const el = d.el(tag);
  for (const c of children) d.insert(el, typeof c === 'string' ? d.text(c) : c);
  return el;
}

/** Children of `el` as HTML, with attributes sorted and internal ones left out. */
function serialize(el: Element, internal: (name: string) => boolean): string {
  let out = '';
  for (const n of el.childNodes) {
    if (n instanceof Text) out += escape(n.data);
    else if (n instanceof Element) {
      const attrs = [...n.attributes]
        .filter((a) => !internal(a.name))
        .map((a) => ` ${a.name}="${escape(a.value)}"`);
      attrs.sort();
      out += `<${n.localName}${attrs.join('')}>${serialize(n, internal)}</${n.localName}>`;
    }
  }
  return out;
}

const escape = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
