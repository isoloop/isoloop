// M1 task 4 spike: which DOM APIs do Preact and React call while rendering into
// Remote DOM's worker-side polyfill? Wraps every method and accessor on the
// polyfill's prototypes and records `Class.member` on use.
// Run: node api-usage.mjs preact|react
process.env.NODE_ENV = 'production';
const { window } = await import('@remote-dom/core/polyfill');

const used = new Map();
const classes = [
  'EventTarget', 'Node', 'CharacterData', 'Text', 'Comment', 'Element', 'HTMLElement',
  'SVGElement', 'Document', 'DocumentFragment', 'Event', 'NodeList', 'DOMTokenList',
  'CSSStyleDeclaration', 'NamedNodeMap', 'Attr', 'Window',
];
const seen = new Set();
// Collect every prototype in the chains of real polyfill nodes too, so mixins
// such as ParentNode and ChildNode (not globals) are wrapped as well.
const protos = [];
for (const name of classes) {
  const C = window[name] ?? globalThis[name];
  if (C?.prototype) protos.push([name, C.prototype]);
}
const doc = window.document;
for (const sample of [doc, doc.createElement('div'), doc.createTextNode(''), doc.createComment(''), doc.createDocumentFragment()]) {
  for (let p = Object.getPrototypeOf(sample); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    protos.push([p.constructor?.name || 'anon', p]);
  }
}
for (const [name, proto] of protos) {
  if (seen.has(proto)) continue;
  seen.add(proto);
  for (const key of Reflect.ownKeys(proto)) {
    if (key === 'constructor' || typeof key === 'symbol') continue;
    const d = Object.getOwnPropertyDescriptor(proto, key);
    const tag = `${name}.${key}`;
    const hit = () => used.set(tag, (used.get(tag) ?? 0) + 1);
    const wrap = (fn) =>
      function (...args) {
        hit();
        return fn.apply(this, args);
      };
    if (typeof d.value === 'function') d.value = wrap(d.value);
    if (d.get) d.get = wrap(d.get);
    if (d.set) d.set = wrap(d.set);
    if (d.configurable) Object.defineProperty(proto, key, d);
  }
}
// The polyfill has no `element.style`, and both frameworks need it. Add a
// minimal shim that writes the `style` attribute, and count its use.
const styles = new WeakMap();
Object.defineProperty(window.Element.prototype, 'style', {
  configurable: true,
  get() {
    used.set('shim.style', (used.get('shim.style') ?? 0) + 1);
    let s = styles.get(this);
    if (!s) {
      const el = this;
      const decl = {};
      const write = () =>
        el.setAttribute('style', Object.entries(decl).map(([k, v]) => `${k}:${v}`).join(';'));
      s = new Proxy(decl, {
        get(t, k) {
          if (k === 'setProperty') return (n, v) => ((t[n] = v), write());
          if (k === 'removeProperty') return (n) => (delete t[n], write());
          if (k === 'cssText') return '';
          return t[k] ?? '';
        },
        set(t, k, v) {
          if (k === 'cssText') return true;
          t[k] = v;
          write();
          return true;
        },
      });
      styles.set(this, s);
    }
    return s;
  },
});
// Plain property writes the frameworks make on elements (value, checked…) land
// as own properties the polyfill never sends to the host. Track elements and
// list their own keys at the end.
const created = [];
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = (tag, ...rest) => {
  const el = origCreate(tag, ...rest);
  created.push(el);
  return el;
};
const propWrites = new Set();

// React's commit phase checks `instanceof HTMLIFrameElement`; the polyfill has none.
const missingGlobals = [];
for (const g of ['HTMLIFrameElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement']) {
  if (!window[g]) {
    missingGlobals.push(g);
    window[g] = globalThis[g] = class {};
  }
}

const which = process.argv[2] ?? 'preact';
const container = window.document.createElement('div');
window.document.body.append(container);
const items0 = ['a', 'b', 'c', 'd'];

if (which === 'preact') {
  const { h, render } = await import('preact');
  const { useState } = await import('preact/hooks');
  let api;
  function App() {
    const [count, setCount] = useState(0);
    const [items, setItems] = useState(items0);
    const [name, setName] = useState('');
    api = { setCount, setItems, setName };
    return h('div', { class: 'app', style: { color: count ? 'red' : 'blue' } },
      h('h1', null, `Count ${count}`),
      h('button', { onClick: () => setCount((c) => c + 1), disabled: count > 5 }, '+'),
      h('input', { value: name, onInput: (e) => setName(e.target.value) }),
      h('label', null, h('input', { type: 'checkbox', checked: count % 2 === 1 }), 'odd'),
      h('ul', null, items.map((i) => h('li', { key: i, 'data-key': i }, i))),
      count > 1 && h('p', null, 'more than one'),
    );
  }
  render(h(App), container);
  for (let i = 0; i < 3; i++) api.setCount((c) => c + 1), await tick();
  api.setItems(['d', 'a', 'c']), await tick();
  api.setName('hello'), await tick();
  container.querySelector('button').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick();
  render(null, container);
} else {
  const React = (await import('react')).default;
  const { createRoot } = (await import('react-dom/client')).default ?? (await import('react-dom/client'));
  const { flushSync } = (await import('react-dom')).default;
  const h = React.createElement;
  let api;
  function App() {
    const [count, setCount] = React.useState(0);
    const [items, setItems] = React.useState(items0);
    const [name, setName] = React.useState('');
    api = { setCount, setItems, setName };
    return h('div', { className: 'app', style: { color: count ? 'red' : 'blue' } },
      h('h1', null, `Count ${count}`),
      h('button', { onClick: () => setCount((c) => c + 1), disabled: count > 5 }, '+'),
      h('input', { value: name, onChange: (e) => setName(e.target.value) }),
      h('label', null, h('input', { type: 'checkbox', checked: count % 2 === 1, readOnly: true }), 'odd'),
      h('ul', null, items.map((i) => h('li', { key: i, 'data-key': i }, i))),
      count > 1 && h('p', null, 'more than one'),
    );
  }
  const root = createRoot(container);
  flushSync(() => root.render(h(App)));
  for (let i = 0; i < 3; i++) flushSync(() => api.setCount((c) => c + 1));
  flushSync(() => api.setItems(['d', 'a', 'c']));
  flushSync(() => api.setName('hello'));
  container.querySelector('button').dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick();
  flushSync(() => root.unmount());
}

function tick() {
  return new Promise((r) => setTimeout(r, 0));
}

for (const el of created) {
  for (const k of Object.keys(el)) if (!/^(__|_react|\$)/.test(k)) propWrites.add(`${el.localName}.${k}`);
}
const sorted = [...used.keys()].sort();
console.log(JSON.stringify({ framework: which, members: sorted.length, used: sorted, propertyWrites: [...propWrites].sort(), missingGlobals }, null, 1));
