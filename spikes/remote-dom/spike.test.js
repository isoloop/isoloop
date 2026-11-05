// M1 task 4 spike, host side: mirror the worker's tree with our own applier
// built on Remote DOM's connection API, and check the three ADR 0006 questions.
import { createRemoteConnection, ROOT_ID } from '@remote-dom/core';
import { expect, test } from 'vitest';

function makeHost(mount) {
  const nodes = new Map([[ROOT_ID, mount]]); // id -> host node
  const ids = new WeakMap([[mount, ROOT_ID]]); // host node -> id
  let removed = [];
  const build = (s) => {
    const existing = nodes.get(s.id);
    if (existing) return existing; // moved node: keep identity
    let node;
    if (s.type === 1) {
      node = document.createElement(s.element);
      for (const [k, v] of Object.entries(s.attributes ?? {})) node.setAttribute(k, v);
      for (const [k, v] of Object.entries(s.properties ?? {})) node[k] = v;
      for (const c of s.children) node.append(build(c));
    } else if (s.type === 3) node = document.createTextNode(s.data);
    else node = document.createComment(s.data);
    nodes.set(s.id, node);
    ids.set(node, s.id);
    return node;
  };
  const connection = createRemoteConnection({
    call() {},
    insertChild(id, child, index) {
      const parent = nodes.get(id);
      parent.insertBefore(build(child), parent.childNodes[index] ?? null);
    },
    removeChild(id, index) {
      const child = nodes.get(id).childNodes[index];
      child.remove();
      removed.push(child); // detach at end of batch, so a move keeps identity
    },
    updateText(id, text) {
      nodes.get(id).data = text;
    },
    updateProperty(id, name, value, type = 1) {
      const el = nodes.get(id);
      if (type === 2) value == null ? el.removeAttribute(name) : el.setAttribute(name, value);
      else if (type === 1) el[name] = value;
    },
  });
  return {
    nodes,
    ids,
    apply(records) {
      connection.mutate(records);
      for (const n of removed) if (!n.isConnected) forget(n);
      removed = [];
    },
  };
  function forget(n) {
    const id = ids.get(n);
    if (id) nodes.delete(id);
    for (const c of n.childNodes) forget(c);
  }
}

test('Remote DOM spike: (a) cloneable records, (b) our ids, (c) listener interception', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const host = makeHost(mount);
  const workerUrl = `${new URL('./worker.js', import.meta.url).href}?worker_file&type=module`;
  const worker = new Worker(workerUrl, { type: 'module' });
  const log = { patches: [], registrations: [] };
  let waiter;
  worker.onmessage = ({ data }) => {
    if (data.t === 'patch') {
      log.patches.push(data.records);
      log.registrations.push(...data.registrations);
      host.apply(data.records);
    }
    waiter?.(data);
  };
  worker.onerror = (e) => console.log('WORKER ERROR', e.message, e.filename, e.lineno);
  const next = (t) => new Promise((r) => (waiter = (d) => d.t === t && r(d)));
  const step = async (name) => {
    const p = next('patch');
    worker.postMessage({ t: 'step', name });
    return p;
  };

  await next('ready');
  await step('build');
  console.log('BUILD', JSON.stringify(log.patches.at(-1)));
  console.log('REGISTRATIONS', JSON.stringify(log.registrations));
  expect(mount.querySelector('h1').textContent).toBe('Hello');
  console.log('INPUT value on host:', JSON.stringify(mount.querySelector('input').value));

  // (b) ids are ours, both ways.
  const button = mount.querySelector('button');
  const buttonId = host.ids.get(button);
  expect(buttonId).toMatch(/^n\d+$/);
  expect(host.nodes.get(buttonId)).toBe(button);

  // (c) event round-trip through our own registration table.
  const reg = log.registrations.find(([op, , type]) => op === 'add' && type === 'click');
  expect(reg?.[1]).toBe(buttonId);
  const clicked = next('patch');
  worker.postMessage({ t: 'event', id: buttonId, type: 'click' });
  await clicked;
  expect(button.textContent).toBe('Clicks: 1');

  await step('update');
  console.log('UPDATE', JSON.stringify(log.patches.at(-1)));
  expect(mount.querySelector('h1').className).toBe('title big');

  const before = [...mount.querySelectorAll('li')];
  await step('reorder');
  console.log('REORDER', JSON.stringify(log.patches.at(-1)));
  const after = [...mount.querySelectorAll('li')];
  expect(after.map((li) => li.textContent)).toEqual(['c', 'a', 'b']);
  console.log('MOVED NODE KEPT IDENTITY:', after[0] === before[2]);

  await step('remove');
  expect([...mount.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['c', 'b']);

  const report = new Promise((r) => (waiter = (d) => d.t === 'report' && r(d.report)));
  worker.postMessage({ t: 'step', name: 'report' });
  console.log('REPORT', JSON.stringify(await report));
  worker.terminate();
});
