// M1 task 4 spike: render a vanilla tree in a worker with Remote DOM's polyfill
// and send its mutation records to the host over postMessage.
// Scratch code: never merged, never published.
import { hooks } from '@remote-dom/core/polyfill';
import { ROOT_ID } from '@remote-dom/core';
import { RemoteRootElement, setRemoteId } from '@remote-dom/core/elements';

// (b) Our own node ids: assign them at creation through the polyfill hook.
let nextId = 1;
const byId = new Map();
const assign = (node) => {
  const id = `n${nextId++}`;
  setRemoteId(node, id);
  byId.set(id, node);
};
hooks.createElement = (element) => {
  // The root keeps Remote DOM's ROOT_ID; everything else gets one of ours.
  if (element.localName !== 'remote-root') assign(element);
};
hooks.createText = (text) => assign(text);

// (c) Intercept listener registration.
const listeners = new Map(); // `${id}:${type}` -> Set<listener>
const registrations = [];
hooks.addEventListener = (target, type, listener) => {
  const id = idOf(target);
  if (id == null) return;
  const key = `${id}:${type}`;
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(listener);
  registrations.push(['add', id, type]);
};
hooks.removeEventListener = (target, type, listener) => {
  const id = idOf(target);
  listeners.get(`${id}:${type}`)?.delete(listener);
  registrations.push(['remove', id, type]);
};
function idOf(node) {
  for (const [id, n] of byId) if (n === node) return id;
  return node === root ? ROOT_ID : undefined;
}

// (a) Every batch is checked for structured-cloneability before it is posted.
const report = { batches: 0, records: 0, cloneFailures: [], jsonMismatch: 0 };
let pending = [];
const connection = {
  mutate(records) {
    pending.push(...records);
    queueMicrotask(flush);
  },
  call() {
    throw new Error('no host calls in the spike');
  },
};
function flush() {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  report.batches++;
  report.records += batch.length;
  try {
    structuredClone(batch);
  } catch (error) {
    report.cloneFailures.push(String(error));
  }
  if (JSON.stringify(JSON.parse(JSON.stringify(batch))) !== JSON.stringify(batch)) {
    report.jsonMismatch++;
  }
  postMessage({ t: 'patch', records: batch, registrations: registrations.splice(0) });
}

customElements.define('remote-root', RemoteRootElement);
const root = document.createElement('remote-root');
root.connect(connection);

let list;
const steps = {
  build() {
    const h1 = document.createElement('h1');
    h1.textContent = 'Hello';
    h1.setAttribute('class', 'title');
    const button = document.createElement('button');
    button.textContent = 'Clicks: 0';
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
      button.textContent = `Clicks: ${clicks}`;
    });
    list = document.createElement('ul');
    for (const key of ['a', 'b', 'c']) {
      const li = document.createElement('li');
      li.setAttribute('data-key', key);
      li.textContent = key;
      list.append(li);
    }
    const input = document.createElement('input');
    input.setAttribute('id', 'name');
    // A property, not an attribute: does it reach the host?
    input.value = 'typed';
    root.append(h1, button, list, input);
  },
  update() {
    root.querySelector('h1').firstChild.data = 'Hello again';
    root.querySelector('h1').setAttribute('class', 'title big');
  },
  reorder() {
    // Move the last item to the front (a keyed reorder).
    list.insertBefore(list.lastChild, list.firstChild);
  },
  remove() {
    list.removeChild(list.children[1]);
  },
  report() {
    postMessage({ t: 'report', report });
  },
};

globalThis.onmessage = ({ data }) => {
  if (data.t === 'step') steps[data.name]();
  if (data.t === 'event') {
    const event = new Event(data.type, { bubbles: true });
    for (const listener of listeners.get(`${data.id}:${data.type}`) ?? []) listener(event);
  }
};
postMessage({ t: 'ready' });
