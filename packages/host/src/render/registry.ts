/*
 * Component registry and sanitiser (design §4.5, invariant I9). Every tag,
 * attribute and property an isolate asks for passes through here before a
 * render bridge touches the DOM. Unknown tags become `div` (`g` in SVG);
 * script-capable tags and `on*` attributes are never created; URLs are
 * limited to http(s), mailto and relative.
 */

/** A host element an isolate may render by name, e.g. `iso-button` → `ds-button`. */
export type HostComponent = {
  /** Custom element name defined on the host page. */
  tag: string;
  /** Attribute names allowed on it beyond the global ones. */
  attributes?: readonly string[];
};

export type Namespace = 'html' | 'svg';

export interface ComponentRegistry {
  /** The element to create for an isolate's tag. */
  element(tag: string, ns: Namespace): { tag: string; ns: Namespace };
  /**
   * The value to write for an attribute on a host element created by
   * `element()`, or `null` to drop it.
   */
  attribute(hostTag: string, ns: Namespace, name: string, value: string): string | null;
  /** Whether an isolate may set this property (`value`, `checked`, `selected`). */
  property(hostTag: string, name: string): boolean;
}

/** The PoC's tags, plus links, images, headings, the table and form families (design §4.5). */
const HTML_TAGS = new Set([
  // PoC
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
  // headings and text
  'h1',
  'h2',
  'h5',
  'h6',
  'br',
  'hr',
  // links and images
  'a',
  'img',
  // tables
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  // forms
  'form',
  'fieldset',
  'legend',
  'select',
  'option',
  'optgroup',
  'textarea',
  'output',
  'progress',
  'meter',
]);

/** SVG for icons and charts: shapes, text, gradients, clipping and same-document `use`. */
const SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'text',
  'tspan',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'symbol',
  'use',
  'title',
]);

/** SVG tag names as the DOM spells them (createElementNS is case-sensitive). */
const SVG_CASE: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
};

const GLOBAL_ATTRS = new Set([
  'id',
  'class',
  'title',
  'lang',
  'dir',
  'role',
  'tabindex',
  'hidden',
  'style',
]);

const HTML_ATTRS: Record<string, readonly string[]> = {
  a: ['href', 'target', 'rel', 'download'],
  img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
  button: ['type', 'name', 'value', 'disabled'],
  input: [
    'type',
    'name',
    'value',
    'placeholder',
    'checked',
    'disabled',
    'readonly',
    'required',
    'min',
    'max',
    'step',
    'pattern',
    'minlength',
    'maxlength',
    'autocomplete',
    'multiple',
    'size',
    'accept',
  ],
  label: ['for'],
  ol: ['start', 'reversed', 'type'],
  li: ['value'],
  col: ['span'],
  colgroup: ['span'],
  th: ['colspan', 'rowspan', 'headers', 'scope', 'abbr'],
  td: ['colspan', 'rowspan', 'headers'],
  form: ['name', 'novalidate', 'autocomplete'],
  fieldset: ['name', 'disabled'],
  select: ['name', 'disabled', 'multiple', 'required', 'size', 'autocomplete'],
  option: ['value', 'selected', 'disabled', 'label'],
  optgroup: ['label', 'disabled'],
  textarea: [
    'name',
    'placeholder',
    'rows',
    'cols',
    'disabled',
    'readonly',
    'required',
    'minlength',
    'maxlength',
    'wrap',
    'autocomplete',
  ],
  output: ['for', 'name'],
  progress: ['value', 'max'],
  meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
};

const SVG_ATTRS = new Set([
  'viewbox',
  'preserveaspectratio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'dx',
  'dy',
  'd',
  'points',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradienttransform',
  'patternunits',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-family',
  'font-weight',
  'href',
  'xlink:href',
]);

/** Element properties an isolate may set, per host tag (ADR 0010; host-owned input rules apply on top). */
const PROPERTIES: Record<string, readonly string[]> = {
  input: ['value', 'checked'],
  textarea: ['value'],
  select: ['value'],
  option: ['selected'],
};

const URL_ATTRS = new Set(['href', 'src', 'xlink:href']);

/** A name `setAttribute` accepts. */
const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_.:-]*$/;
/** A custom element name: lowercase, starts with a letter, contains a hyphen. */
const CUSTOM_ELEMENT = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

/**
 * Whether `value` is a URL an isolate may use: http(s), mailto, or relative.
 * Browsers ignore ASCII whitespace and control characters inside a scheme
 * (`java\tscript:`), so those are removed before the scheme is read.
 */
export function isSafeUrl(value: string): boolean {
  // oxlint-disable-next-line no-control-regex -- control characters are what browsers strip
  const v = value.replaceAll(/[\u0000- \u007f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(v)?.[1];
  return scheme === undefined || scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

/** Throws if a host component entry is malformed. */
function checkComponents(components: Readonly<Record<string, HostComponent>>): void {
  for (const [name, c] of Object.entries(components)) {
    if (!CUSTOM_ELEMENT.test(name)) {
      throw new TypeError(`components: "${name}" is not a custom element name (needs a hyphen).`);
    }
    if (!CUSTOM_ELEMENT.test(c.tag)) {
      throw new TypeError(`components["${name}"].tag "${c.tag}" is not a custom element name.`);
    }
    for (const a of c.attributes ?? []) {
      if (!VALID_NAME.test(a) || /^on/i.test(a) || a.toLowerCase() === 'srcdoc') {
        throw new TypeError(`components["${name}"]: attribute "${a}" can't be allowed.`);
      }
    }
  }
}

export function createRegistry(
  opts: { components?: Readonly<Record<string, HostComponent>> } = {},
): ComponentRegistry {
  const components = opts.components ?? {};
  checkComponents(components);
  const hostTags = new Map(Object.values(components).map((c) => [c.tag, c] as const));

  const allowedAttr = (hostTag: string, ns: Namespace, name: string): boolean => {
    if (GLOBAL_ATTRS.has(name) || name.startsWith('aria-') || name.startsWith('data-')) return true;
    if (ns === 'svg') return SVG_ATTRS.has(name);
    const host = hostTags.get(hostTag);
    if (host) return host.attributes?.includes(name) ?? false;
    return HTML_ATTRS[hostTag]?.includes(name) ?? false;
  };

  return {
    element(tag, ns) {
      const t = tag.toLowerCase();
      if (ns === 'svg') return { tag: SVG_TAGS.has(t) ? (SVG_CASE[t] ?? t) : 'g', ns };
      const host = Object.hasOwn(components, t) ? components[t] : undefined;
      if (host) return { tag: host.tag, ns };
      return { tag: HTML_TAGS.has(t) ? t : 'div', ns };
    },

    attribute(hostTag, ns, rawName, value) {
      if (!VALID_NAME.test(rawName)) return null;
      const name = rawName.toLowerCase();
      // Event handlers and inline documents never reach the DOM, whatever the tag.
      if (name.startsWith('on') || name === 'srcdoc') return null;
      if (!allowedAttr(hostTag.toLowerCase(), ns, name)) return null;
      if (name === 'style') return /javascript:|expression\s*\(/i.test(value) ? null : value;
      if (URL_ATTRS.has(name)) {
        // SVG <use> may only point inside the document; external references load other files.
        if (ns === 'svg') return value.trimStart().startsWith('#') ? value : null;
        return isSafeUrl(value) ? value : null;
      }
      if (name === 'target') return /^_(self|blank|parent|top)$/.test(value) ? value : null;
      return value;
    },

    property(hostTag, name) {
      return PROPERTIES[hostTag.toLowerCase()]?.includes(name) ?? false;
    },
  };
}
