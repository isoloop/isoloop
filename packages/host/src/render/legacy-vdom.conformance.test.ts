import { runBridgeConformance, type Handle, type IsolateDriver } from '@isoloop/dom/testing';
import { createLegacyVdomBridge } from './legacy-vdom';

type El = Handle & {
  id: string;
  kind: 'el';
  tag: string;
  attrs: Map<string, string>;
  listeners: Set<string>;
  value?: string;
  children: Node[];
  parent?: El;
};
type Txt = Handle & { id: string; kind: 'text'; data: string; parent?: El };
type Node = El | Txt;
type VNode = { t: string; p: Record<string, string>; c: (VNode | string)[] };

/**
 * The isolate side of legacy-vdom: a tree of handles, sent whole on every
 * flush, as the M0 runtime does. Listeners become `on<type>` props naming the
 * node, which is what the host sends back as the event target.
 */
function createLegacyDriver(): IsolateDriver {
  let next = 0;
  let dirty = true;
  const byId = new Map<string, Node>();
  const nodes = new WeakMap<Handle, Node>();
  const track = <T extends Node>(node: T): T => {
    byId.set(node.id, node);
    nodes.set(node, node);
    return node;
  };
  const el = (tag: string): El =>
    track({
      __handle: true,
      id: `h${next++}`,
      kind: 'el',
      tag,
      attrs: new Map(),
      listeners: new Set(),
      children: [],
    });
  const asNode = (h: Handle): Node => {
    const n = nodes.get(h);
    if (!n) throw new Error('not a handle from this driver');
    return n;
  };
  const asEl = (h: Handle): El => {
    const n = asNode(h);
    if (n.kind !== 'el') throw new Error('not an element');
    return n;
  };
  const detach = (n: Node) => {
    if (!n.parent) return;
    n.parent.children = n.parent.children.filter((c) => c !== n);
    delete n.parent;
  };
  const toVNode = (n: El): VNode => {
    const p: Record<string, string> = Object.fromEntries(n.attrs);
    for (const type of n.listeners) p[`on${type}`] = n.id;
    if (n.value !== undefined) p['value'] = n.value;
    return { t: n.tag, p, c: n.children.map((c) => (c.kind === 'text' ? c.data : toVNode(c))) };
  };
  const root = el('div');
  root.attrs.set('class', 'cf-root');

  return {
    root,
    el,
    text: (data) => track<Txt>({ __handle: true, id: `h${next++}`, kind: 'text', data }),
    insert(parent, child, before) {
      const p = asEl(parent);
      const c = asNode(child);
      detach(c);
      const at = before ? p.children.indexOf(asNode(before)) : -1;
      p.children.splice(at < 0 ? p.children.length : at, 0, c);
      c.parent = p;
      dirty = true;
    },
    remove(child) {
      detach(asNode(child));
      dirty = true;
    },
    setAttr(h, name, value) {
      const n = asEl(h);
      if (value === null) n.attrs.delete(name);
      else n.attrs.set(name, value);
      dirty = true;
    },
    setText(h, data) {
      const n = asNode(h);
      if (n.kind !== 'text') throw new Error('not a text node');
      n.data = data;
      dirty = true;
    },
    setValue(h, value) {
      asEl(h).value = value;
      dirty = true;
    },
    listen(h, type) {
      asEl(h).listeners.add(type);
      dirty = true;
    },
    flush() {
      if (!dirty) return [];
      dirty = false;
      return [toVNode(root)];
    },
    idOf: (h) => asNode(h).id,
    handleFor: (id) => byId.get(id),
  };
}

runBridgeConformance(
  'legacy-vdom',
  () => ({
    host: createLegacyVdomBridge(),
    isolate: createLegacyDriver(),
    internalAttr: (name) => name.startsWith('data-fed-'),
  }),
  // legacy-vdom diffs by index, has no node ids, and writes `value` even while
  // the input is focused. The Remote DOM bridge (task 5) has none of these gaps.
  { knownGaps: ['keyed', 'ids', 'inputs'] },
);
