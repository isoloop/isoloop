import type { DomBatch } from '../shared/records';
import {
  createDom,
  WCharacterData,
  WElement,
  WNode,
  WParentNode,
  type WorkerDom,
} from '../worker/dom';
import type { Handle, IsolateDriver } from './conformance';

const noop = (): void => {};

/**
 * The isolate side of isoloop-dom for the conformance suite: the real
 * worker-side subset, run in the test page without installing globals.
 * Batches are collected and handed over on `flush()`.
 */
export function createIsoloopDomDriver(): IsolateDriver & { dom: WorkerDom } {
  const batches: DomBatch[] = [];
  const dom = createDom({ onBatch: (b) => batches.push(b), schedule: () => {} });
  const handles = new WeakMap<Handle, WNode>();
  const byId = new Map<string, Handle>();
  const handleOf = new WeakMap<WNode, Handle>();
  const wrap = (n: WNode): Handle => {
    const h: Handle = { __handle: true };
    handles.set(h, n);
    handleOf.set(n, h);
    byId.set(String(dom.idOf(n)), h);
    return h;
  };
  const node = (h: Handle): WNode => {
    const n = handles.get(h);
    if (!n) throw new Error('not a handle from this driver');
    return n;
  };
  const el = (h: Handle): WElement => {
    const n = node(h);
    if (!(n instanceof WElement)) throw new Error('not an element');
    return n;
  };
  const cfRoot = dom.document.createElement('div');
  cfRoot.setAttribute('class', 'cf-root');
  dom.root.appendChild(cfRoot);

  return {
    dom,
    root: wrap(cfRoot),
    el: (tag) => wrap(dom.document.createElement(tag)),
    text: (data) => wrap(dom.document.createTextNode(data)),
    comment: (data) => wrap(dom.document.createComment(data)),
    fragment: () => wrap(dom.document.createDocumentFragment()),
    childCount: (h) => node(h).childNodes.length,
    insert(parent, child, before) {
      const p = node(parent);
      if (!(p instanceof WParentNode)) throw new Error('not a parent');
      p.insertBefore(node(child), before ? node(before) : null);
    },
    remove: (child) => node(child).remove(),
    setAttr(h, name, value) {
      if (value === null) el(h).removeAttribute(name);
      else el(h).setAttribute(name, value);
    },
    setText(h, data) {
      const n = node(h);
      if (!(n instanceof WCharacterData)) throw new Error('not a text or comment node');
      n.data = data;
    },
    setValue(h, value, force) {
      if (force) dom.setValue(el(h), value, { force: true });
      else Object.assign(el(h), { value });
    },
    listen: (h, type) => el(h).addEventListener(type, noop),
    classList(h, op, token, force) {
      const list = el(h).classList;
      if (op === 'toggle')
        return force === undefined ? list.toggle(token) : list.toggle(token, force);
      if (op === 'contains') return list.contains(token);
      list[op](token);
      return list.contains(token);
    },
    dataset(h, key, value) {
      const data = el(h).dataset;
      if (value === null) delete data[key];
      else if (value !== undefined) data[key] = value;
      return data[key];
    },
    byId(id) {
      const n = dom.document.getElementById(id);
      return n ? (handleOf.get(n) ?? null) : null;
    },
    contains: (a, b) => node(a).contains(b ? node(b) : null),
    flush() {
      dom.flush();
      return batches.splice(0);
    },
    idOf: (h) => String(dom.idOf(node(h))),
    handleFor: (id) => byId.get(id),
  };
}
