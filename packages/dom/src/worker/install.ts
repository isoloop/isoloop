import {
  WElement,
  WHTMLElement,
  WHTMLIFrameElement,
  WHTMLInputElement,
  WHTMLOptionElement,
  WHTMLSelectElement,
  WHTMLTextAreaElement,
  WNode,
  WSVGElement,
  WText,
  type WorkerDom,
} from './dom';

/** The DOM globals the subset provides (ADR 0010 point 2), by their DOM names. */
export const DOM_GLOBALS: Readonly<Record<string, unknown>> = {
  Node: WNode,
  Element: WElement,
  HTMLElement: WHTMLElement,
  SVGElement: WSVGElement,
  Text: WText,
  HTMLInputElement: WHTMLInputElement,
  HTMLTextAreaElement: WHTMLTextAreaElement,
  HTMLSelectElement: WHTMLSelectElement,
  HTMLOptionElement: WHTMLOptionElement,
  HTMLIFrameElement: WHTMLIFrameElement,
};

/**
 * Exposes `dom` as the worker's `document`, `window` and DOM classes, so
 * frameworks find them where they look. Only for isolates with a surface; a
 * headless isolate never calls this.
 */
export function install(dom: WorkerDom, scope: object): void {
  const define = (name: string, value: unknown) => {
    Object.defineProperty(scope, name, { value, configurable: true, writable: true });
  };
  define('document', dom.document);
  if (!('window' in scope)) define('window', scope);
  for (const [name, value] of Object.entries(DOM_GLOBALS)) define(name, value);
  dom.document.defaultView = scope;
}
