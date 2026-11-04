/*
 * The proof of concept's virtual DOM diff behind HostRenderBridge. Each batch
 * is a whole tree; the diff patches the previous one in place. Tags outside an
 * allow-list render as div, and only a fixed set of props is ever written.
 * Event props (`onclick: 'inc'`) become `data-fed-click="inc"`; the event's
 * target is that handler name.
 */
import type { Mods } from '@isoloop/protocol';
import type { HostRenderBridge } from './bridge';

export const LEGACY_VDOM = 'legacy-vdom@1';

type PropValue = string | number | boolean | null;
type Props = Record<string, PropValue>;
type VNode = { t: string; p: Props; c: (VNode | string)[] };
type Child = VNode | string;

const ALLOWED_TAGS = new Set([
  'div',
  'span',
  'p',
  'button',
  'input',
  'label',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'pre',
  'h3',
  'h4',
  'small',
]);

const ATTRS = /^(style|type|placeholder|title|aria-[a-z]+)$/;

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isPropValue = (x: unknown): x is PropValue =>
  x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';

/** The tree comes from an isolate, so it is checked before anything touches the DOM. */
export function isVNode(x: unknown, depth = 0): x is VNode {
  if (depth > 256 || !isRecord(x)) return false;
  const { t, p, c } = x;
  return (
    typeof t === 'string' &&
    isRecord(p) &&
    Object.values(p).every((v) => v === undefined || isPropValue(v)) &&
    Array.isArray(c) &&
    c.every((k: unknown) => typeof k === 'string' || isVNode(k, depth + 1))
  );
}

const str = (v: PropValue | undefined): string => (v === null || v === undefined ? '' : String(v));

function setProp(el: Element, k: string, v: PropValue | undefined): void {
  if (k.startsWith('on')) el.setAttribute(`data-fed-${k.slice(2)}`, str(v));
  else if (k === 'value') {
    if (el instanceof HTMLInputElement && el.value !== str(v)) el.value = str(v);
  } else if (k === 'checked') {
    if (el instanceof HTMLInputElement) el.checked = Boolean(v);
  } else if (k === 'disabled') {
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) el.disabled = Boolean(v);
  } else if (k === 'class') el.className = str(v);
  else if (ATTRS.test(k)) el.setAttribute(k, str(v));
}

function unsetProp(el: Element, k: string): void {
  if (k.startsWith('on')) el.removeAttribute(`data-fed-${k.slice(2)}`);
  else if (k === 'class') el.className = '';
  else el.removeAttribute(k);
}

function setProps(el: Element, oldP: Props, newP: Props): void {
  for (const k of Object.keys(oldP)) if (!(k in newP)) unsetProp(el, k);
  for (const [k, v] of Object.entries(newP)) if (oldP[k] !== v) setProp(el, k, v);
}

function build(v: Child): Node {
  if (typeof v === 'string') return document.createTextNode(v);
  const el = document.createElement(ALLOWED_TAGS.has(v.t) ? v.t : 'div');
  setProps(el, {}, v.p);
  for (const c of v.c) el.append(build(c));
  return el;
}

function patch(
  parent: Node,
  node: ChildNode | undefined,
  oldV: Child | undefined,
  newV: Child | undefined,
): void {
  if (oldV === undefined) {
    if (newV !== undefined) parent.appendChild(build(newV));
    return;
  }
  if (!node) return;
  if (newV === undefined) {
    node.remove();
    return;
  }
  const changed =
    typeof oldV !== typeof newV ||
    (typeof newV === 'string' ? oldV !== newV : typeof oldV === 'string' || oldV.t !== newV.t);
  if (changed) {
    node.replaceWith(build(newV));
    return;
  }
  if (typeof newV === 'string' || typeof oldV === 'string' || !(node instanceof Element)) return;
  setProps(node, oldV.p, newV.p);
  const kids = [...node.childNodes];
  const len = Math.max(oldV.c.length, newV.c.length);
  for (let i = 0; i < len; i++) patch(node, kids[i], oldV.c[i], newV.c[i]);
}

const mods = (e: MouseEvent | KeyboardEvent): Mods => ({
  alt: e.altKey,
  ctrl: e.ctrlKey,
  meta: e.metaKey,
  shift: e.shiftKey,
});

/** `value` of form controls; buttons have one too (`''` unless set), as in the PoC. */
const valueOf = (el: Element): { value: string } | Record<string, never> =>
  el instanceof HTMLInputElement || el instanceof HTMLButtonElement ? { value: el.value } : {};

export function createLegacyVdomBridge(): HostRenderBridge {
  let container: HTMLElement | null = null;
  let tree: VNode | null = null;
  const abort = new AbortController();

  return {
    fmt: LEGACY_VDOM,

    mount(shadow, send) {
      container = document.createElement('div');
      container.className = 'iso-root';
      shadow.append(container);
      const { signal } = abort;

      shadow.addEventListener(
        'click',
        (e) => {
          if (!(e instanceof MouseEvent) || !(e.target instanceof Element)) return;
          const el = e.target.closest('[data-fed-click]');
          const target = el?.getAttribute('data-fed-click');
          if (!el || !target) return;
          send({
            type: 'click',
            target,
            currentTargets: [target],
            mods: mods(e),
            ...valueOf(el),
            x: e.clientX,
            y: e.clientY,
            button: e.button,
          });
        },
        { signal },
      );
      shadow.addEventListener(
        'input',
        (e) => {
          const el = e.target;
          if (!(el instanceof HTMLInputElement)) return;
          const target = el.getAttribute('data-fed-input');
          if (!target) return;
          send({
            type: 'input',
            target,
            currentTargets: [target],
            mods: { alt: false, ctrl: false, meta: false, shift: false },
            value: el.value,
          });
        },
        { signal },
      );
      shadow.addEventListener(
        'keydown',
        (e) => {
          if (!(e instanceof KeyboardEvent) || e.key !== 'Enter') return;
          const el = e.target;
          if (!(el instanceof HTMLInputElement)) return;
          const target = el.getAttribute('data-fed-enter');
          if (!target) return;
          e.preventDefault();
          send({
            type: 'keydown',
            target,
            currentTargets: [target],
            key: e.key,
            code: e.code,
            mods: mods(e),
            value: el.value,
          });
        },
        { signal },
      );
    },

    apply(batch) {
      if (!container || !isVNode(batch)) return false;
      if (!tree) container.replaceChildren(build(batch));
      else patch(container, container.firstChild ?? undefined, tree, batch);
      tree = batch;
      return true;
    },

    unmount() {
      abort.abort();
      container?.remove();
      container = null;
      tree = null;
    },
  };
}
