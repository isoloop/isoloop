/*
 * A tiny helper for the vanilla isolates: builds elements with the DOM calls
 * the isoloop-dom subset provides (createElement, setAttribute, append).
 */
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c) e.append(c);
  return e;
}

/** Bus values are `unknown`; show strings as they are and anything else as JSON. */
export const text = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
