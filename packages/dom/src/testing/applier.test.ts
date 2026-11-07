import { afterEach, describe, expect, it } from 'vitest';
import { createApplier, type SanitisePolicy } from '../host/applier';
import type { DomBatch } from '../shared/records';
import { createDom, WElement, WHTMLInputElement, type WNode } from '../worker/dom';
import { runBridgeConformance, type ConformanceEvent, type ConformanceHost } from './conformance';
import { createIsoloopDomDriver } from './driver';

/**
 * A small stand-in for the host's component registry, so the package can be
 * tested alone. The real policy lives in @isoloop/host and runs the same suite.
 */
const TAGS = new Set(['div', 'span', 'p', 'strong', 'ul', 'li', 'button', 'input', 'a', 'i']);
const testPolicy: SanitisePolicy = {
  element: (tag, ns) => ({ tag: ns === 'svg' ? tag : TAGS.has(tag) ? tag : 'div', ns }),
  attribute: (_tag, isoNs, name, value) =>
    /^on/i.test(name) || name === 'srcdoc' || /^\s*javascript:/i.test(value) ? null : value,
  // Host-owned inputs: never overwrite the value the user is typing into.
  property: (el, name, _value, force) => force || !(name === 'value' && isFocused(el)),
};
const isFocused = (el: Element) => {
  const root = el.getRootNode();
  return (root instanceof ShadowRoot || root instanceof Document) && root.activeElement === el;
};

const EVENTS = ['click', 'input', 'change', 'keydown'];

/** The minimal host bridge around the applier: a container and delegated listeners. */
function testBridge(policy: SanitisePolicy = testPolicy): ConformanceHost & {
  idFor(node: Node): string | undefined;
  nodeFor(id: string): Element | undefined;
} {
  let applier: ReturnType<typeof createApplier> | null = null;
  const abort = new AbortController();
  return {
    mount(shadow, send) {
      const container = document.createElement('div');
      shadow.append(container);
      const a = createApplier(container, policy);
      applier = a;
      for (const type of EVENTS) {
        shadow.addEventListener(
          type,
          (e) => {
            const rec = a.eventFor(e);
            if (!rec) return;
            const ev: ConformanceEvent = {
              type: rec.type,
              target: String(rec.target),
              currentTargets: rec.currentTargets.map(String),
              mods: rec.mods,
              ...(rec.value === undefined ? {} : { value: rec.value }),
            };
            send(ev);
          },
          { signal: abort.signal },
        );
      }
    },
    apply: (batch) => applier?.apply(batch) ?? false,
    unmount() {
      abort.abort();
      applier?.clear();
      applier = null;
    },
    idFor(node) {
      const id = applier?.idFor(node);
      return id === undefined ? undefined : String(id);
    },
    nodeFor(id) {
      const n = applier?.nodeFor(Number(id));
      return n instanceof Element ? n : undefined;
    },
  };
}

runBridgeConformance('isoloop-dom (test policy)', () => ({
  host: testBridge(),
  isolate: createIsoloopDomDriver(),
}));

const containers: Element[] = [];
afterEach(() => {
  for (const c of containers.splice(0)) c.remove();
});

function pair(policy: SanitisePolicy = testPolicy) {
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const applier = createApplier(container, policy);
  const batches: DomBatch[] = [];
  const dom = createDom({ onBatch: (b) => batches.push(b), schedule: () => {} });
  const sync = () => {
    dom.flush();
    for (const b of batches.splice(0)) expect(applier.apply(structuredClone(b))).toBe(true);
  };
  return { container, applier, dom, doc: dom.document, sync };
}

/** The worker tree as HTML, attributes in insertion order, like innerHTML. */
function workerHtml(n: WNode): string {
  if (!(n instanceof WElement)) return n.textContent;
  const attrs = n.attributes.map((a) => ` ${a.name}="${a.value}"`).join('');
  return `<${n.localName}${attrs}>${n.childNodes.map(workerHtml).join('')}</${n.localName}>`;
}

describe('applier', () => {
  it('a batch round-trip leaves identical innerHTML on both sides', () => {
    const { container, dom, doc, sync } = pair();
    const ul = doc.createElement('ul');
    ul.setAttribute('class', 'list');
    for (let i = 0; i < 5; i++) {
      const li = doc.createElement('li');
      li.setAttribute('data-i', String(i));
      li.append(`item ${i} `, doc.createElement('strong'));
      ul.appendChild(li);
    }
    dom.root.appendChild(ul);
    sync();
    const kid = (i: number): WElement => {
      const n = ul.childNodes[i];
      if (!(n instanceof WElement)) throw new Error(`no element at ${i}`);
      return n;
    };
    ul.insertBefore(kid(4), kid(0));
    kid(2).setAttribute('class', 'mid');
    ul.removeChild(kid(3));
    sync();
    expect(container.innerHTML).toBe(dom.root.childNodes.map(workerHtml).join(''));
  });

  it('renders a 1,000-node list and reverses it with moves, keeping every node', () => {
    const { container, dom, doc, sync } = pair();
    const ul = doc.createElement('ul');
    const items: WElement[] = [];
    for (let i = 0; i < 1000; i++) {
      const li = doc.createElement('li');
      li.textContent = String(i);
      items.push(li);
      ul.appendChild(li);
    }
    dom.root.appendChild(ul);
    sync();
    const before = [...container.querySelectorAll('li')];
    expect(before).toHaveLength(1000);
    for (const li of items) ul.insertBefore(li, ul.firstChild);
    sync();
    const after = [...container.querySelectorAll('li')];
    expect(after.map((li) => li.textContent)).toEqual(items.map((_, i) => String(999 - i)));
    expect(new Set(after)).toEqual(new Set(before));
  });

  it('passes every tag and attribute through the policy', () => {
    const calls: string[] = [];
    const { container, dom, doc, sync } = pair({
      element: (tag, ns) => {
        calls.push(`element ${tag}`);
        return { tag: tag === 'blink' ? 'span' : tag, ns };
      },
      attribute: (tag, isoNs, name, value) => {
        calls.push(`attr ${tag}.${name}`);
        return name === 'bad' ? null : value;
      },
      property: () => false,
    });
    const b = doc.createElement('blink');
    b.setAttribute('ok', '1');
    b.setAttribute('bad', '1');
    dom.root.appendChild(b);
    sync();
    expect(container.innerHTML).toBe('<span ok="1"></span>');
    expect(calls).toEqual(['element blink', 'attr span.ok', 'attr span.bad']);
  });

  it('rejects malformed batches without touching the DOM', () => {
    const { container, applier } = pair();
    container.append('keep');
    for (const bad of [
      null,
      {},
      [['insert', 0, { k: 'el', id: 1, tag: 'p' }, null]],
      [['move', -1, 2, null]],
      [['prop', 1, 'innerHTML', 'x']],
      [['attr', 1, 'x']],
      [['nope']],
    ]) {
      expect(applier.apply(bad)).toBe(false);
    }
    expect(container.innerHTML).toBe('keep');
  });

  it('only events with a registered listener on the path become records', () => {
    const { container, applier, dom, doc, sync } = pair();
    const outer = doc.createElement('div');
    const inner = doc.createElement('span');
    outer.appendChild(inner);
    outer.addEventListener('click', () => {});
    dom.root.appendChild(outer);
    sync();
    const span = container.querySelector('span');
    if (!span) throw new Error('no span');
    const click = new MouseEvent('click', { bubbles: true, altKey: true, clientX: 3 });
    let rec: unknown;
    container.addEventListener('click', (e) => (rec = applier.eventFor(e)), { once: true });
    span.dispatchEvent(click);
    expect(rec).toMatchObject({
      type: 'click',
      target: dom.idOf(inner),
      currentTargets: [dom.idOf(outer)],
      mods: { alt: true },
      x: 3,
    });
    let none: unknown = 'unset';
    container.addEventListener('keydown', (e) => (none = applier.eventFor(e)), { once: true });
    span.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(none).toBeNull();
  });

  it("a checkbox reports `checked` only when the worker doesn't know it yet", () => {
    const { container, applier, dom, doc, sync } = pair();
    const input = doc.createElement('input');
    if (!(input instanceof WHTMLInputElement)) throw new Error('no worker input');
    input.setAttribute('type', 'checkbox');
    input.checked = true;
    for (const t of ['click', 'input', 'change']) input.addEventListener(t, () => {});
    dom.root.appendChild(input);
    sync();
    const real = container.querySelector('input');
    if (!real) throw new Error('no input');
    const seen: unknown[] = [];
    for (const t of ['click', 'input', 'change'])
      container.addEventListener(t, (e) => seen.push(applier.eventFor(e)?.checked));
    // One click fires click, input and change with the same state: only the
    // first reports it, so the later ones can't undo what the worker set since.
    real.click();
    expect(seen.splice(0)).toEqual([false, undefined, undefined]);
    // The worker sets it back and then forward again, as React does with a
    // controlled checkbox whose state arrives later: the next click reports.
    input.checked = true;
    sync();
    input.checked = false;
    sync();
    expect(real.checked).toBe(false);
    real.click();
    expect(seen.splice(0)).toEqual([true, undefined, undefined]);
  });

  it('clear() empties the container and forgets ids', () => {
    const { container, applier, dom, doc, sync } = pair();
    const p = doc.createElement('p');
    dom.root.appendChild(p);
    sync();
    const host = container.querySelector('p');
    if (!host) throw new Error('no p');
    applier.clear();
    expect(container.childNodes).toHaveLength(0);
    expect(applier.idFor(host)).toBeUndefined();
    expect(applier.nodeFor(dom.idOf(p))).toBeUndefined();
  });
});
