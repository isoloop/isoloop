import {
  WComment,
  WDocumentFragment,
  WDOMTokenList,
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
  layoutError,
  type WorkerDom,
} from './dom';

/**
 * The DOM globals the subset provides (ADR 0010 point 2), by their DOM names.
 *
 * @internal
 */
export const DOM_GLOBALS: Readonly<Record<string, unknown>> = {
  Node: WNode,
  Element: WElement,
  HTMLElement: WHTMLElement,
  SVGElement: WSVGElement,
  Text: WText,
  Comment: WComment,
  DocumentFragment: WDocumentFragment,
  HTMLInputElement: WHTMLInputElement,
  HTMLTextAreaElement: WHTMLTextAreaElement,
  HTMLSelectElement: WHTMLSelectElement,
  HTMLOptionElement: WHTMLOptionElement,
  HTMLIFrameElement: WHTMLIFrameElement,
  DOMTokenList: WDOMTokenList,
};

/**
 * Exposes `dom` as the worker's `document`, `window` and DOM classes, so
 * frameworks find them where they look. Only for isolates with a surface; a
 * headless isolate never calls this.
 *
 * @internal
 */
export function install(dom: WorkerDom, scope: object): void {
  const define = (name: string, value: unknown) => {
    Object.defineProperty(scope, name, { value, configurable: true, writable: true });
  };
  define('document', dom.document);
  if (!('window' in scope)) define('window', scope);
  for (const [name, value] of Object.entries(DOM_GLOBALS)) define(name, value);
  // Computed styles need layout too (ADR 0010, amended 2026-11-16, point 5).
  if (!('getComputedStyle' in scope)) {
    define('getComputedStyle', (): never => {
      throw layoutError(
        'getComputedStyle()',
        'read the styles the isolate set (`el.style`), or ask the host for sizes with `ctx.host.measure(node)`',
      );
    });
  }
  dom.document.defaultView = scope;
}
