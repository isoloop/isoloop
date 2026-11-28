// The `html` tagged template (ADR 0026, amended 2026-11-28): every value is
// escaped unless it's SafeHtml, made by `html` itself or marked with `raw()`.
// Arrays are joined; null, undefined, true and false render nothing. Every
// Archeion script adds itself to the one global `AR`, so the page and the tests
// (which load these files in a VM) see the same functions.
(function (AR) {
  class SafeHtml {
    constructor(html) {
      this.html = html;
    }
    toString() {
      return this.html;
    }
  }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escape = (s) => String(s).replace(/[&<>"']/g, (m) => ESC[m]);
  const part = (v) => {
    if (v === null || v === undefined || v === false || v === true) return '';
    if (v instanceof SafeHtml) return v.html;
    if (Array.isArray(v)) return v.map(part).join('');
    return escape(v);
  };
  /** Builds SafeHtml from a template literal, escaping every value. */
  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += part(values[i]) + strings[i + 1];
    return new SafeHtml(out);
  }
  /** Marks a string as HTML that's already safe. Use only on HTML this code built. */
  const raw = (s) => new SafeHtml(String(s));
  /** Attributes from an object: false or null drops one, true writes it bare. */
  function attrs(obj) {
    const out = [];
    for (const [k, v] of Object.entries(obj || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (!/^[a-zA-Z_:][\w:.-]*$/.test(k)) throw new Error(`attrs: bad attribute name "${k}"`);
      out.push(v === true ? k : `${k}="${escape(v)}"`);
    }
    return raw(out.join(' '));
  }
  /** Text with `backticks` as <code>, everything else escaped. */
  const md = (s) => raw(escape(s).replace(/`([^`]+)`/g, '<code>$1</code>'));
  /** Joins SafeHtml parts with a separator. */
  const join = (parts, sep = '') => raw(parts.map(part).join(part(sep)));

  Object.assign(AR, { SafeHtml, html, raw, attrs, md, join, escape });
})((globalThis.AR ??= {}));
