/** Render format of the M0 virtual DOM, as sent in `patch.fmt`. */
export const LEGACY_VDOM = 'legacy-vdom@1';

export type PropValue = string | number | boolean | null | undefined;
export type Props = Record<string, PropValue>;

/** A virtual DOM node: tag, props, children. Event props (`onclick: 'inc'`) name a handler. */
export type VNode = { t: string; p: Props; c: (VNode | string)[] };

export type Child = VNode | string | number | boolean | null | undefined | readonly Child[];

const isChildList = (x: Child): x is readonly Child[] => Array.isArray(x);

function flatten(children: readonly Child[], out: (VNode | string)[]): (VNode | string)[] {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === 'string') out.push(c);
    else if (typeof c === 'number' || typeof c === 'boolean') out.push(String(c));
    else if (isChildList(c)) flatten(c, out);
    else out.push(c);
  }
  return out;
}

/** Builds a node. Children are flattened; `null`, `undefined` and `false` are dropped. */
export function h(tag: string, props?: Props | null, ...children: Child[]): VNode {
  return { t: tag, p: props ?? {}, c: flatten(children, []) };
}
