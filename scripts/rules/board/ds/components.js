// Components (ADR 0026, amended 2026-11-28): plain functions returning SafeHtml,
// plus the layout primitives and the one tooltip. They take token names, never
// values: a gap is a space step ('4'), a width is a token ('col-min').
(function (AR) {
  const { html, attrs, raw } = AR;
  const TOKEN = /^[a-z0-9-]+$/;
  const token = (name, what) => {
    if (!TOKEN.test(String(name))) throw new Error(`${what}: "${name}" isn't a token name`);
    return String(name);
  };
  const vars = (pairs) =>
    pairs
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `--ar-${k}: ${v}`)
      .join('; ');

  // --- Layout primitives ------------------------------------------------------

  const gapVar = (gap) => (gap === undefined ? undefined : `var(--ar-space-${token(gap, 'gap')})`);
  const layout = (cls, style, opts) => {
    const tag = opts.as || 'div';
    if (!/^[a-z]+$/.test(tag)) throw new Error(`layout: bad tag "${tag}"`);
    return html`<${raw(tag)} class="${cls}" ${attrs({ style: style || null, ...opts.attrs })}
      >${opts.children}</${raw(tag)}
    >`;
  };
  /** A column with `gap` (a space step) between its children. */
  const Stack = (o = {}) => layout('ar-stack', vars([['gap', gapVar(o.gap)]]), o);
  /** A wrapping row. `align` and `justify` take CSS keywords. */
  const Cluster = (o = {}) =>
    layout(
      'ar-cluster',
      vars([
        ['gap', gapVar(o.gap)],
        ['align', o.align && token(o.align, 'align')],
        ['justify', o.justify && token(o.justify, 'justify')],
      ]),
      o,
    );
  /** Columns at least `min` wide (a token, e.g. 'col-min'). */
  const Grid = (o = {}) =>
    layout(
      'ar-grid',
      vars([
        ['gap', gapVar(o.gap)],
        ['min', o.min && `var(--ar-${token(o.min, 'min')})`],
      ]),
      o,
    );
  /** A fixed side (a token, e.g. 'date-col') and the rest; stacks when narrow. */
  const Split = (o = {}) =>
    layout(
      'ar-split',
      vars([
        ['gap', gapVar(o.gap)],
        ['side', o.side && `var(--ar-${token(o.side, 'side')})`],
      ]),
      o,
    );

  // --- Components -------------------------------------------------------------

  /**
   * Tabs: { items: [{ id, label }], selected, label, role: 'tab' | 'radio',
   * key: the data attribute that carries each id (default 'view'), idPrefix }.
   */
  function Tabs({ items, selected, label, role = 'tab', key = 'view', idPrefix }) {
    return html`<div
      class="ar-tabs"
      ${attrs({ role: role === 'tab' ? 'tablist' : 'radiogroup', 'aria-label': label })}
    >
      ${items.map(
        (it) =>
          html`<button
            class="ar-tabs-item"
            ${attrs({
              role,
              id: idPrefix ? idPrefix + it.id : null,
              ['data-' + key]: it.id,
              'aria-selected': String(it.id === selected),
            })}
          >
            ${it.label}
          </button>`,
      )}
    </div>`;
  }

  /** Pill: { text, tone: ok|info|warn|off|gone|accent, variant: soft|outline|code }. */
  const Pill = ({ text, tone, variant }) =>
    html`<span class="ar-pill" ${attrs({ 'data-tone': tone, 'data-variant': variant })}
      >${text}</span
    >`;

  /** Dot: a small marker in a tone. */
  const Dot = ({ tone }) => html`<span class="ar-dot" ${attrs({ 'data-tone': tone })}></span>`;

  /** Chip: a toggle. { label, pressed, count, tone (for a dot), slot (for a chart swatch), attrs }. */
  const Chip = ({ label, pressed = false, count, tone, slot, attrs: a }) =>
    html`<button class="ar-chip" ${attrs({ 'aria-pressed': String(pressed), ...a })}>
      ${tone ? Dot({ tone }) : ''}${
        slot === undefined
          ? ''
          : html`<span class="ar-legend-swatch" ${attrs({ 'data-slot': slot })}></span>`
      }${label}${count === undefined ? '' : html`<span class="ar-chip-count">${count}</span>`}
    </button>`;

  /**
   * Card: { as: 'button' | 'div', attrs, dim, top: [start, end], body, foot: [start, end] }.
   * `top` and `foot` are rows with their parts pushed apart.
   */
  function Card({ as = 'div', attrs: a, dim = false, top, body, foot }) {
    const row = (cls, parts) =>
      parts ? html`<div class="${cls}">${parts.map((p) => html`<span>${p}</span>`)}</div>` : '';
    const inner = html`${row('ar-card-top', top)}${body}${row('ar-card-foot', foot)}`;
    const at = attrs({ 'data-dim': dim, ...a });
    return as === 'button'
      ? html`<button class="ar-card" ${at}>${inner}</button>`
      : html`<div class="ar-card" ${at}>${inner}</div>`;
  }

  /**
   * Drawer: { labelId, title, lead, facts: [[term, value]], sections: [{ heading, body }] }.
   * Anything marked `data-close` closes it.
   */
  function Drawer({ labelId = 'ar-drawer-title', title, lead, facts = [], sections = [] }) {
    return html`<div class="ar-drawer-scrim" data-close></div>
      <aside
        class="ar-drawer"
        role="dialog"
        aria-modal="true"
        ${attrs({ 'aria-labelledby': labelId })}
      >
        <div class="ar-drawer-head">
          <div class="ar-stack" id="${labelId}">${title}${lead || ''}</div>
          <button class="ar-drawer-close" data-close aria-label="Close">×</button>
        </div>
        ${
          facts.length
            ? html`<dl class="ar-drawer-facts">
                ${facts.map(
                  ([k, v]) =>
                    html`<dt>${k}</dt>
                      <dd>${v}</dd>`,
                )}
              </dl>`
            : ''
        }
        ${sections.map(
          (s) =>
            html`<section class="ar-stack">
              <h3 class="ar-drawer-h">${s.heading}</h3>
              ${s.body}
            </section>`,
        )}
      </aside>`;
  }

  /** Table: { caption, columns: [{ key, label, align: 'start' | 'end' }], rows, rowAttrs(row) }. */
  function Table({ caption, columns, rows, rowAttrs }) {
    return html`<div class="ar-table-wrap">
      <table class="ar-table">
        ${
          caption
            ? html`<caption>
                ${caption}
              </caption>`
            : ''
        }
        <thead>
          <tr>
            ${columns.map((c) => html`<th scope="col" ${attrs({ 'data-align': c.align })}>${c.label}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr ${attrs(rowAttrs ? rowAttrs(r) : {})}>
                ${columns.map(
                  (c) => html`<td ${attrs({ 'data-align': c.align })}>${r[c.key]}</td>`,
                )}
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  /** Legend: { items: [{ label, slot: 1-8 | 'other', or tone: ok|info|…, value }], label }. */
  const Legend = ({ items, label }) =>
    html`<ul class="ar-legend" ${attrs({ 'aria-label': label })}>
      ${items.map(
        (it) =>
          html`<li class="ar-legend-item">
            <span
              class="ar-legend-swatch"
              ${attrs({ 'data-slot': it.tone ? null : it.slot, 'data-tone': it.tone })}
            ></span
            >${it.label}${
              it.value === undefined ? '' : html` <span class="ar-legend-value">${it.value}</span>`
            }
          </li>`,
      )}
    </ul>`;

  /** EmptyState: { text, size: 'm' | 'l' }. */
  const EmptyState = ({ text, size }) =>
    html`<p class="ar-empty" ${attrs({ 'data-size': size === 'l' ? 'l' : null })}>${text}</p>`;

  /** Field: { id, label, type, placeholder, value, hideLabel }. */
  const Field = ({ id, label, type = 'text', placeholder, value, hideLabel = false }) =>
    html`<label class="ar-field" ${attrs({ for: id })}
      ><span class="ar-field-label" ${attrs({ 'data-hidden': hideLabel })}>${label}</span
      ><input class="ar-field-input" ${attrs({ id, type, placeholder, value })}
    /></label>`;

  /**
   * Select: { id, label, options: [{ id, label }], selected, hideLabel }. A
   * native select, so the keyboard and screen readers work as everywhere.
   */
  const Select = ({ id, label, options, selected, hideLabel = false }) =>
    html`<label class="ar-field" ${attrs({ for: id })}
      ><span class="ar-field-label" ${attrs({ 'data-hidden': hideLabel })}>${label}</span
      ><select class="ar-field-input ar-select" ${attrs({ id })}>
        ${options.map(
          (o) =>
            html`<option ${attrs({ value: o.id, selected: o.id === selected })}>
              ${o.label}
            </option>`,
        )}
      </select></label
    >`;

  /**
   * Stepper: a range over ordered items with previous and next buttons.
   * { id, label, items: [{ id, label }], selected }. The range's value is the
   * index; the buttons carry `data-stepper` (the id) and `data-step` (−1 or 1),
   * and are disabled at the ends. The current item's label is in an <output>.
   */
  function Stepper({ id, label, items, selected }) {
    const i = Math.max(
      0,
      items.findIndex((it) => it.id === selected),
    );
    const last = items.length - 1;
    const step = (dir, text, name, off) =>
      html`<button
        class="ar-stepper-step"
        type="button"
        ${attrs({ 'data-stepper': id, 'data-step': dir, 'aria-label': name, disabled: off })}
      >
        ${text}
      </button>`;
    return html`<div class="ar-stepper" role="group" ${attrs({ 'aria-label': label })}>
      ${step('-1', '‹', 'Earlier', i <= 0)}
      <input
        class="ar-stepper-range"
        type="range"
        ${attrs({
          id,
          min: 0,
          max: last,
          step: 1,
          value: i,
          'aria-label': label,
          'aria-valuetext': items[i] ? items[i].label : '',
        })}
      />
      ${step('1', '›', 'Later', i >= last)}
      <output class="ar-stepper-value" ${attrs({ for: id })}
        >${items[i] ? items[i].label : ''}</output
      >
    </div>`;
  }

  /** Badge: a small marker that a thing has a state worth noticing. { text, tone }. */
  const Badge = ({ text, tone = 'accent' }) =>
    html`<span class="ar-badge" ${attrs({ 'data-tone': tone })}>${text}</span>`;

  /** BeforeAfter: two versions side by side. { before, after, labels: [before, after] }. */
  const BeforeAfter = ({ before, after, labels = ['Before', 'After'] }) =>
    html`<div class="ar-compare">
      <div class="ar-compare-side" data-side="before">
        <span class="ar-compare-label">${labels[0]}</span>
        <p class="ar-compare-text">${before}</p>
      </div>
      <div class="ar-compare-side" data-side="after">
        <span class="ar-compare-label">${labels[1]}</span>
        <p class="ar-compare-text">${after}</p>
      </div>
    </div>`;

  /** Toolbar: { label, children }. */
  const Toolbar = ({ label, children, attrs: a }) =>
    html`<div class="ar-toolbar" role="toolbar" ${attrs({ 'aria-label': label, ...a })}>
      ${children}
    </div>`;

  /** ChartFrame: { title, sub, legend, body, note, attrs }. */
  const ChartFrame = ({ title, sub, legend, body, note, attrs: a }) =>
    html`<figure class="ar-chart" ${attrs(a)}>
      ${
        title || sub
          ? html`<div class="ar-stack">
              ${title ? html`<h3 class="ar-chart-title">${title}</h3>` : ''}${
                sub ? html`<p class="ar-chart-sub">${sub}</p>` : ''
              }
            </div>`
          : ''
      }${legend || ''}
      <div class="ar-chart-body">${body}</div>
      ${note ? html`<figcaption class="ar-chart-note">${note}</figcaption>` : ''}
    </figure>`;

  /** The one tooltip: show(content, clientX, clientY) and hide(). It never covers the pointer. */
  const tooltip = {
    el: null,
    show(content, x, y) {
      if (typeof document === 'undefined') return;
      if (!this.el) {
        this.el = document.createElement('div');
        this.el.className = 'ar-tooltip';
        this.el.setAttribute('role', 'tooltip');
        document.body.appendChild(this.el);
      }
      this.el.innerHTML = String(content);
      this.el.hidden = false;
      const box = this.el.getBoundingClientRect();
      const left = Math.min(x + 12, window.innerWidth - box.width - 8);
      const top = y + 16 + box.height > window.innerHeight ? y - box.height - 12 : y + 16;
      this.el.style.left = Math.max(8, left) + 'px';
      this.el.style.top = Math.max(8, top) + 'px';
    },
    hide() {
      if (this.el) this.el.hidden = true;
    },
  };
  /** Markup for a tooltip placed in flow, for the specimen. */
  const Tooltip = ({ content }) =>
    html`<div class="ar-tooltip" role="tooltip" data-static>${content}</div>`;

  Object.assign(AR, {
    Stack,
    Cluster,
    Grid,
    Split,
    Tabs,
    Pill,
    Dot,
    Chip,
    Card,
    Drawer,
    Table,
    Legend,
    EmptyState,
    Field,
    Select,
    Stepper,
    Badge,
    BeforeAfter,
    Toolbar,
    ChartFrame,
    Tooltip,
    tooltip,
  });
})((globalThis.AR ??= {}));
