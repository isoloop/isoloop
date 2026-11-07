import { describe, expect, it } from 'vitest';
import { ROOT_ID, type DomBatch, type DomRecord } from '../shared/records';
import {
  createDom,
  WElement,
  WHTMLInputElement,
  WHTMLOptionElement,
  WHTMLSelectElement,
  WHTMLTextAreaElement,
  WSVGElement,
  type WNode,
} from '../worker/dom';
import { DOM_GLOBALS, install } from '../worker/install';

const noop = (): void => {};

function setup() {
  const batches: DomBatch[] = [];
  const dom = createDom({ onBatch: (b) => batches.push(b), schedule: () => {} });
  const records = (): DomRecord[] => {
    dom.flush();
    return batches.splice(0).flat();
  };
  return { dom, doc: dom.document, root: dom.root, records };
}

const el = (n: WNode | null): WElement => {
  if (!(n instanceof WElement)) throw new Error('not an element');
  return n;
};

describe('recording', () => {
  it('sends a subtree built while detached as one insert', () => {
    const { doc, root, records } = setup();
    const ul = doc.createElement('ul');
    for (const k of ['a', 'b']) {
      const li = doc.createElement('li');
      li.setAttribute('data-k', k);
      li.textContent = k;
      ul.appendChild(li);
    }
    ul.addEventListener('click', () => {});
    expect(records()).toEqual([]); // nothing is known yet
    root.appendChild(ul);
    const rs = records();
    expect(rs).toHaveLength(1);
    const [insert] = rs;
    expect(insert?.[0]).toBe('insert');
    expect(insert?.[1]).toBe(ROOT_ID);
    expect(insert?.[3]).toBeNull();
    expect(insert?.[2]).toMatchObject({
      k: 'el',
      tag: 'ul',
      ns: 'html',
      listen: ['click'],
      children: [
        { k: 'el', tag: 'li', attrs: [['data-k', 'a']], children: [{ k: 'text', data: 'a' }] },
        { k: 'el', tag: 'li', attrs: [['data-k', 'b']], children: [{ k: 'text', data: 'b' }] },
      ],
    });
  });

  it('records a move inside the tree as one move record', () => {
    const { doc, root, dom, records } = setup();
    const [a, b, c] = ['a', 'b', 'c'].map((t) => {
      const s = doc.createElement('span');
      s.textContent = t;
      root.appendChild(s);
      return s;
    });
    if (!a || !b || !c) throw new Error('setup');
    records();
    root.insertBefore(c, a);
    expect(records()).toEqual([['move', ROOT_ID, dom.idOf(c), dom.idOf(a)]]);
    expect(root.childNodes.map((n) => n.textContent)).toEqual(['c', 'a', 'b']);
    root.appendChild(c);
    expect(records()).toEqual([['move', ROOT_ID, dom.idOf(c), null]]);
  });

  it('records text, attribute, property and listener changes on known nodes', () => {
    const { doc, root, dom, records } = setup();
    const input = doc.createElement('input');
    const t = doc.createTextNode('x');
    root.append(input, t);
    records();
    const id = dom.idOf(input);
    t.data = 'y';
    input.setAttribute('Title', 'T');
    input.removeAttribute('title');
    input.removeAttribute('title'); // already gone: no record
    if (!(input instanceof WHTMLInputElement)) throw new Error('not an input');
    input.value = 'v';
    input.value = 'v'; // unchanged: no record
    input.checked = true;
    input.addEventListener('input', noop);
    input.addEventListener('input', () => {}); // second listener: no record
    input.removeEventListener('input', noop);
    expect(records()).toEqual([
      ['text', dom.idOf(t), 'y'],
      ['attr', id, 'title', 'T'],
      ['attr', id, 'title', null],
      ['prop', id, 'value', 'v'],
      ['prop', id, 'checked', true],
      ['listen', id, 'input', true],
    ]);
  });

  it('removing a node records remove once and forgets its subtree', () => {
    const { doc, root, dom, records } = setup();
    const p = doc.createElement('p');
    const t = doc.createTextNode('x');
    p.appendChild(t);
    root.appendChild(p);
    records();
    p.remove();
    t.data = 'changed while detached';
    expect(records()).toEqual([['remove', dom.idOf(p)]]);
    root.appendChild(p);
    const [rec] = records();
    expect(rec?.[0]).toBe('insert');
    expect(JSON.stringify(rec)).toContain('changed while detached');
  });

  it('batches survive structuredClone unchanged', () => {
    const { doc, root, records } = setup();
    const div = doc.createElement('div');
    div.style.setProperty('--x', '1');
    div.addEventListener('click', () => {});
    root.appendChild(div);
    const rs = records();
    expect(structuredClone(rs)).toEqual(rs);
    expect(JSON.parse(JSON.stringify(rs))).toEqual(rs);
  });

  it('schedules one flush per batch', () => {
    const flushes: (() => void)[] = [];
    const batches: DomBatch[] = [];
    const dom = createDom({ onBatch: (b) => batches.push(b), schedule: (f) => flushes.push(f) });
    const a = dom.document.createElement('a');
    dom.root.appendChild(a);
    a.setAttribute('href', '/x');
    expect(flushes).toHaveLength(1);
    flushes[0]?.();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });
});

describe('the subset', () => {
  it('keeps siblings, children and text consistent', () => {
    const { doc, root } = setup();
    root.append('a', doc.createElement('b'), 'c');
    expect(root.childNodes).toHaveLength(3);
    expect(root.children.map((c) => c.localName)).toEqual(['b']);
    expect(root.firstChild?.nextSibling?.nodeName).toBe('B');
    expect(root.lastChild?.previousSibling?.nodeType).toBe(1);
    expect(root.textContent).toBe('ac');
    root.replaceChildren('only');
    expect(root.textContent).toBe('only');
    expect(root.firstChild?.parentNode).toBe(root);
  });

  it('refuses cycles and foreign reference nodes', () => {
    const { doc, root } = setup();
    const a = doc.createElement('div');
    const b = doc.createElement('div');
    a.appendChild(b);
    expect(() => b.appendChild(a)).toThrow(/cycle/);
    expect(() => root.insertBefore(doc.createElement('i'), b)).toThrow(/reference/);
  });

  it('style writes, setProperty and cssText become the style attribute', () => {
    const { doc } = setup();
    const p = doc.createElement('p');
    p.style['backgroundColor'] = 'red';
    p.style.setProperty('--gap', '2px');
    expect(p.getAttribute('style')).toBe('background-color: red; --gap: 2px;');
    expect(p.style['backgroundColor']).toBe('red');
    p.style.removeProperty('background-color');
    p.style.setProperty('--gap', null);
    expect(p.hasAttribute('style')).toBe(false);
    p.style.cssText = 'color: blue; margin: 0';
    expect(p.getAttribute('style')).toBe('color: blue; margin: 0;');
  });

  it('creates the classes frameworks check with instanceof', () => {
    const { doc } = setup();
    expect(DOM_GLOBALS['HTMLInputElement']).toBe(WHTMLInputElement);
    expect(DOM_GLOBALS['SVGElement']).toBe(WSVGElement);
    expect(doc.createElement('INPUT')).toBeInstanceOf(WHTMLInputElement);
    expect(doc.createElement('textarea')).toBeInstanceOf(WHTMLTextAreaElement);
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    expect(svg).toBeInstanceOf(WSVGElement);
    expect(svg.tagName).toBe('linearGradient');
    expect(doc.createElement('div').tagName).toBe('DIV');
    expect(() => doc.createElementNS('http://www.w3.org/1998/Math/MathML', 'math')).toThrow();
  });

  it('install() exposes document, window and the DOM classes on a scope', () => {
    const { dom } = setup();
    const scope: Record<string, unknown> = {};
    install(dom, scope);
    expect(scope['document']).toBe(dom.document);
    expect(scope['window']).toBe(scope);
    expect(scope['HTMLIFrameElement']).toBeTypeOf('function');
    expect(dom.document.defaultView).toBe(scope);
  });
});

describe('what the usage logs asked for (M3a task 2)', () => {
  it('select.options walks options and optgroups; option members reflect attributes', () => {
    const { dom: d, doc, root, records } = setup();
    const dom = (n: WNode) => d.idOf(n);
    const select = doc.createElement('select');
    if (!(select instanceof WHTMLSelectElement)) throw new Error('not a select');
    const a = doc.createElement('option');
    a.textContent = 'A';
    const group = doc.createElement('optgroup');
    const b = doc.createElement('option');
    b.setAttribute('value', 'bee');
    group.append(b);
    select.append(a, group);
    root.append(select);
    records();
    expect(select.options).toEqual([a, b]);
    if (!(a instanceof WHTMLOptionElement) || !(b instanceof WHTMLOptionElement)) {
      throw new Error('not options');
    }
    expect([a.value, b.value]).toEqual(['A', 'bee']);
    a.value = 'ay';
    a.defaultSelected = true;
    b.disabled = true;
    select.multiple = true;
    expect(records()).toEqual([
      ['attr', dom(a), 'value', 'ay'],
      ['attr', dom(a), 'selected', ''],
      ['attr', dom(b), 'disabled', ''],
      ['attr', dom(select), 'multiple', ''],
    ]);
    expect([a.defaultSelected, b.disabled, select.multiple]).toEqual([true, true, true]);
  });

  it('reports elements inserted into document.head, and records nothing for them', () => {
    const batches: DomBatch[] = [];
    const head: string[] = [];
    const dom = createDom({
      onBatch: (b) => batches.push(b),
      schedule: () => {},
      onHead: (tag) => head.push(tag),
    });
    const doc = dom.document;
    doc.head.insertBefore(doc.createElement('title'), null);
    doc.head.appendChild(doc.createElement('meta'));
    doc.head.appendChild(doc.createTextNode('ignored'));
    doc.body.appendChild(doc.createElement('title'));
    dom.flush();
    expect(head).toEqual(['title', 'meta']);
    expect(batches).toEqual([]);
  });

  it('document.head is detached, and querySelector finds `head > title` in it', () => {
    const { doc, records } = setup();
    expect(doc.ownerDocument).toBe(null);
    expect(doc.querySelector('head > title')).toBe(null);
    const title = doc.createElement('title');
    doc.head.insertBefore(title, null);
    expect(doc.querySelector('head > title')).toBe(title);
    expect(doc.querySelector('title')).toBe(title);
    expect(doc.querySelector('body > title')).toBe(null);
    expect(records()).toEqual([]);
    expect(() => doc.querySelector('.cls')).toThrow(/isn't supported/);
  });
});

describe('deliver', () => {
  it('dispatches with capture and bubble, and syncs value without echoing a record', () => {
    const { doc, root, dom, records } = setup();
    const form = doc.createElement('form');
    const input = doc.createElement('input');
    form.appendChild(input);
    root.appendChild(form);
    const seen: string[] = [];
    root.addEventListener('input', () => seen.push('root capture'), true);
    form.addEventListener('input', (e) => seen.push(`form bubble ${e.eventPhase}`));
    input.addEventListener('input', (e) => {
      const t = e.target;
      seen.push(`input ${t instanceof WHTMLInputElement ? t.value : '?'}`);
    });
    records();
    dom.deliver({
      type: 'input',
      target: dom.idOf(input),
      currentTargets: [dom.idOf(input)],
      value: 'typed',
      mods: { alt: false, ctrl: false, meta: false, shift: true },
    });
    expect(seen).toEqual(['root capture', 'input typed', 'form bubble 3']);
    expect(records()).toEqual([]);
    if (!(input instanceof WHTMLInputElement)) throw new Error('not an input');
    input.value = 'typed'; // a controlled input writing back the same value
    expect(records()).toEqual([]);
  });

  it('stopPropagation stops the bubble', () => {
    const { doc, root, dom } = setup();
    const b = doc.createElement('button');
    root.appendChild(b);
    const seen: string[] = [];
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      seen.push('button');
    });
    root.addEventListener('click', () => seen.push('root'));
    dom.deliver({
      type: 'click',
      target: dom.idOf(b),
      currentTargets: [],
      mods: { alt: false, ctrl: false, meta: false, shift: false },
    });
    expect(seen).toEqual(['button']);
  });

  it('ignores events for nodes the host shouldn’t know', () => {
    const { doc, dom } = setup();
    const detached = el(doc.createElement('button'));
    let hit = false;
    detached.addEventListener('click', () => {
      hit = true;
    });
    dom.deliver({
      type: 'click',
      target: dom.idOf(detached),
      currentTargets: [],
      mods: { alt: false, ctrl: false, meta: false, shift: false },
    });
    expect(hit).toBe(false);
  });
});
