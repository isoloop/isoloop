import type { SerializedEvent } from '@isoloop/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createLegacyVdomBridge, isVNode } from './legacy-vdom';

const n = (t: string, p: Record<string, unknown> = {}, ...c: unknown[]) => ({ t, p, c });

const mounted: (() => void)[] = [];
afterEach(() => {
  for (const off of mounted.splice(0)) off();
});

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const sent: SerializedEvent[] = [];
  const bridge = createLegacyVdomBridge();
  bridge.mount(shadow, (e) => sent.push(e));
  mounted.push(() => {
    bridge.unmount();
    host.remove();
  });
  const root = (): Element => {
    const el = shadow.querySelector('.iso-root')?.firstElementChild;
    if (!el) throw new Error('nothing rendered');
    return el;
  };
  return { bridge, shadow, sent, root };
}

describe('isVNode', () => {
  it.each([
    ['a node', n('div', {}, 'x', n('b'))],
    ['props with null and undefined', n('div', { a: null, b: undefined, c: 1, d: true })],
  ])('accepts %s', (_name, x) => {
    expect(isVNode(x)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'div'],
    ['no tag', { p: {}, c: [] }],
    ['children not an array', { t: 'div', p: {}, c: 'x' }],
    ['an object prop', n('div', { style: { color: 'red' } })],
    ['a number child', n('div', {}, 1)],
    ['a bad grandchild', n('div', {}, n('p', {}, { t: 1 }))],
  ])('rejects %s', (_name, x) => {
    expect(isVNode(x)).toBe(false);
  });

  it('rejects trees deeper than 256', () => {
    let deep: unknown = n('i');
    for (let i = 0; i < 300; i++) deep = n('b', {}, deep);
    expect(isVNode(deep)).toBe(false);
  });
});

describe('legacy-vdom bridge', () => {
  it('renders allowed tags and turns others into div', () => {
    const { bridge, root } = mount();
    expect(
      bridge.apply(n('div', {}, n('button', {}, 'ok'), n('script', {}, 'alert(1)'), n('iframe'))),
    ).toBe(true);
    expect(root().innerHTML).toBe('<button>ok</button><div>alert(1)</div><div></div>');
  });

  it('writes only allowed props; event props become data-fed-*', () => {
    const { bridge, root } = mount();
    bridge.apply(
      n('button', {
        class: 'primary',
        onclick: 'inc',
        style: 'color: red',
        href: 'javascript:x',
        id: 'x',
        'aria-label': 'Go',
        srcdoc: 'x',
      }),
    );
    const el = root();
    expect(el.className).toBe('primary');
    expect(el.getAttribute('data-fed-click')).toBe('inc');
    expect(el.getAttribute('style')).toBe('color: red');
    expect(el.getAttribute('aria-label')).toBe('Go');
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.hasAttribute('id')).toBe(false);
    expect(el.hasAttribute('srcdoc')).toBe(false);
    expect(el.hasAttribute('onclick')).toBe(false);
  });

  it('patches in place: same nodes, new text, removed props and children', () => {
    const { bridge, root } = mount();
    bridge.apply(n('div', { class: 'a' }, n('span', {}, '1'), n('p', {}, 'x')));
    const span = root().firstElementChild;
    bridge.apply(n('div', {}, n('span', {}, '2')));
    expect(root().firstElementChild).toBe(span);
    expect(root().outerHTML).toBe('<div class=""><span>2</span></div>');
  });

  it('replaces a node whose tag changed', () => {
    const { bridge, root } = mount();
    bridge.apply(n('div', {}, n('span', {}, 'x')));
    bridge.apply(n('div', {}, n('strong', {}, 'x')));
    expect(root().innerHTML).toBe('<strong>x</strong>');
  });

  it('keeps a typed value unless the tree changes it', () => {
    const { bridge, root } = mount();
    bridge.apply(n('input', { value: '' }));
    const input = root();
    if (!(input instanceof HTMLInputElement)) throw new Error('no input');
    input.value = 'typed';
    bridge.apply(n('input', { value: '' }));
    expect(input.value).toBe('typed');
    bridge.apply(n('input', { value: 'x' }));
    expect(input.value).toBe('x');
  });

  it('rejects a malformed batch and keeps the last good tree', () => {
    const { bridge, root } = mount();
    bridge.apply(n('p', {}, 'ok'));
    expect(bridge.apply({ t: 'p', p: {}, c: [{}] })).toBe(false);
    expect(root().outerHTML).toBe('<p>ok</p>');
  });

  it('sends click, input and Enter as serialized events', () => {
    const { bridge, root, sent } = mount();
    bridge.apply(
      n(
        'div',
        {},
        n('button', { onclick: 'inc' }, n('span', {}, 'go')),
        n('input', { oninput: 'type', onenter: 'send' }),
      ),
    );
    const [button, input] = [...root().children];
    if (!(input instanceof HTMLInputElement)) throw new Error('no input');
    button?.firstElementChild?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true }),
    );
    input.value = 'hi';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    expect(sent.map((e) => [e.type, e.target, e.value])).toEqual([
      ['click', 'inc', ''],
      ['input', 'type', 'hi'],
      ['keydown', 'send', 'hi'],
    ]);
    expect(sent[0]?.mods.shift).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('stops sending events after unmount', () => {
    const { bridge, root, sent, shadow } = mount();
    bridge.apply(n('button', { onclick: 'inc' }));
    const button = root();
    bridge.unmount();
    shadow.append(button);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(sent).toEqual([]);
  });
});
