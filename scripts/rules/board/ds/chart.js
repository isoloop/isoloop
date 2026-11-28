// The chart toolkit (ADR 0026, amended 2026-11-28): scales, ticks, axes, SVG
// helpers and categorical slots. Everything returns plain numbers or SafeHtml;
// colours come from slots (data-slot 1–8 or 'other'), never from literals.
(function (AR) {
  const { html, attrs, raw } = AR;

  /** Round numbers for about `count` ticks between a and b: steps of 1, 2 or 5 × 10^k. */
  function ticks(a, b, count = 5) {
    if (!(b > a)) return [a];
    const raw0 = (b - a) / Math.max(1, count);
    const pow = 10 ** Math.floor(Math.log10(raw0));
    const err = raw0 / pow;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * pow;
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step)
      out.push(Number(v.toFixed(12)));
    return out;
  }

  /** A linear scale from [d0, d1] onto [r0, r1], with ticks() and invert(). */
  function scaleLinear([d0, d1], [r0, r1]) {
    const span = d1 - d0 || 1;
    const f = (v) => r0 + ((v - d0) / span) * (r1 - r0);
    f.domain = [d0, d1];
    f.range = [r0, r1];
    f.ticks = (n) => ticks(Math.min(d0, d1), Math.max(d0, d1), n);
    f.invert = (px) => d0 + ((px - r0) / (r1 - r0 || 1)) * span;
    return f;
  }

  /** A band scale: each value gets a band; f(v) is its start, f.bandwidth() its width. */
  function scaleBand(values, [r0, r1], padding = 0.1) {
    const n = values.length || 1;
    const step = (r1 - r0) / n;
    const pad = step * padding;
    const index = new Map(values.map((v, i) => [v, i]));
    const f = (v) => (index.has(v) ? r0 + index.get(v) * step + pad / 2 : undefined);
    f.bandwidth = () => step - pad;
    f.step = () => step;
    f.domain = values;
    return f;
  }

  const DAY = 86400000;
  const toDay = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / DAY);
  const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);

  /** A scale over dates (YYYY-MM-DD) by whole days; ticks() returns dates. */
  function scaleTime([a, b], range) {
    const lin = scaleLinear([toDay(a), toDay(b)], range);
    const f = (d) => lin(toDay(d));
    f.ticks = (n = 6) => {
      const d0 = toDay(a);
      const d1 = toDay(b);
      const step = Math.max(1, Math.ceil((d1 - d0) / Math.max(1, n)));
      const out = [];
      for (let d = d0; d <= d1; d += step) out.push(fromDay(d));
      return out;
    };
    f.days = () => toDay(b) - toDay(a) + 1;
    f.domain = [a, b];
    return f;
  }

  const n = (v) => Number(v.toFixed(2));

  /** An <svg> sized by its viewBox, labelled for screen readers. */
  const svg = ({ width, height, label, body, attrs: a }) =>
    html`<svg
      viewBox="0 0 ${n(width)} ${n(height)}"
      role="img"
      ${attrs({ 'aria-label': label, ...a })}
    >
      ${body}
    </svg>`;
  const line = ({ x1, y1, x2, y2, cls = 'ar-chart-grid', attrs: a }) =>
    html`<line
      class="${cls}"
      x1="${n(x1)}"
      y1="${n(y1)}"
      x2="${n(x2)}"
      y2="${n(y2)}"
      ${attrs(a)}
    ></line>`;
  const rect = ({ x, y, width, height, slot, cls = 'ar-chart-mark', attrs: a }) =>
    html`<rect
      class="${cls}"
      x="${n(x)}"
      y="${n(y)}"
      width="${n(Math.max(0, width))}"
      height="${n(Math.max(0, height))}"
      ${attrs({ 'data-slot': slot, ...a })}
    ></rect>`;
  const circle = ({ cx, cy, r, slot, cls = 'ar-chart-mark', attrs: a }) =>
    html`<circle
      class="${cls}"
      cx="${n(cx)}"
      cy="${n(cy)}"
      r="${n(r)}"
      ${attrs({ 'data-slot': slot, ...a })}
    ></circle>`;
  const text = ({ x, y, value, anchor = 'start', cls = 'ar-chart-label', attrs: a }) =>
    html`<text class="${cls}" x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" ${attrs(a)}
      >${value}</text
    >`;
  const path = ({ d, slot, cls = 'ar-chart-mark', attrs: a }) =>
    html`<path class="${cls}" d="${d}" fill="none" ${attrs({ 'data-slot': slot, ...a })}></path>`;

  /** An axis along the bottom at `y`, from `scale` (with ticks()), each label from `format`. */
  function axisBottom({ scale, y, count, format = String, size = 4, values }) {
    const [r0, r1] = scale.range || [0, 0];
    const vs = values || scale.ticks(count);
    return html`<g class="ar-chart-axis-bottom"
      >${line({ x1: Math.min(r0, r1), y1: y, x2: Math.max(r0, r1), y2: y, cls: 'ar-chart-axis-line' })}${vs.map(
        (v) =>
          html`${line({ x1: scale(v), y1: y, x2: scale(v), y2: y + size, cls: 'ar-chart-tick' })}${text(
            {
              x: scale(v),
              y: y + size + 12,
              value: format(v),
              anchor: 'middle',
              cls: 'ar-chart-axis',
            },
          )}`,
      )}</g
    >`;
  }

  /** An axis down the left at `x`, with optional grid lines across to `gridTo`. */
  function axisLeft({ scale, x, count, format = String, size = 4, gridTo, values }) {
    const vs = values || scale.ticks(count);
    return html`<g class="ar-chart-axis-left"
      >${vs.map(
        (v) =>
          html`${gridTo === undefined ? '' : line({ x1: x, y1: scale(v), x2: gridTo, y2: scale(v) })}${line(
            {
              x1: x - size,
              y1: scale(v),
              x2: x,
              y2: scale(v),
              cls: 'ar-chart-tick',
            },
          )}${text({ x: x - size - 4, y: scale(v) + 4, value: format(v), anchor: 'end', cls: 'ar-chart-axis' })}`,
      )}</g
    >`;
  }

  /**
   * Categorical slots: the `max` (8) biggest categories get slots 1–8, in their
   * given order; the rest share 'other'. items: [{ key, label, count }].
   * Returns { slotOf(key), groups: [{ key, label, slot, count }] } for a legend.
   */
  function slots(items, max = 8) {
    const ranked = [...items].sort((a, b) => (b.count || 0) - (a.count || 0));
    const keep = new Set(ranked.slice(0, max).map((x) => x.key));
    const map = new Map();
    let next = 1;
    const groups = [];
    let other = null;
    for (const it of items) {
      if (keep.has(it.key)) {
        const slot = next++;
        map.set(it.key, slot);
        groups.push({ key: it.key, label: it.label ?? it.key, slot, count: it.count });
      } else {
        map.set(it.key, 'other');
        other ??= { key: 'other', label: 'Other', slot: 'other', count: 0, keys: [] };
        other.count += it.count || 0;
        other.keys.push(it.key);
      }
    }
    if (other) groups.push(other);
    return { slotOf: (k) => map.get(k) ?? 'other', groups };
  }

  /** A Legend from slot groups. */
  const legendFor = (groups, label) =>
    AR.Legend({
      label,
      items: groups.map((g) => ({ label: g.label, slot: g.slot, value: g.count })),
    });

  // --- Heat: a sequential ramp of 5 steps (--ar-heat-1 … 5) plus empty ----------

  /** The heat step for a count: 0 (none), then 1, 2, 3–4, 5–6, 7+ as steps 1–5. */
  const heatStep = (count) =>
    count <= 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : count <= 6 ? 4 : 5;
  /** The labels for the 5 steps, in order. */
  const HEAT_LABELS = ['1', '2', '3–4', '5–6', '7+'];

  /**
   * One heatmap cell: a rect in its heat step, with the count written on it when
   * it fits. Empty cells are drawn faint and carry no attributes.
   */
  function heatCell({ x, y, width, height, count, showCount = true, attrs: a }) {
    const step = heatStep(count);
    const box = html`<rect
      class="ar-heat-cell"
      x="${n(x)}"
      y="${n(y)}"
      width="${n(Math.max(0, width))}"
      height="${n(Math.max(0, height))}"
      data-heat="${step}"
    ></rect>`;
    if (!step) return box;
    return html`<g class="ar-heat" ${attrs(a)}
      >${box}${
        showCount
          ? text({
              x: x + width / 2,
              y: y + height / 2,
              value: count,
              anchor: 'middle',
              cls: 'ar-heat-count',
              attrs: { 'data-heat': step, 'dominant-baseline': 'central' },
            })
          : ''
      }</g
    >`;
  }

  /** The heat ramp as a legend: none, then each step with its label. */
  const HeatRamp = ({ label = 'Colour scale' } = {}) =>
    html`<div
      class="ar-heat-ramp"
      role="img"
      ${attrs({ 'aria-label': `${label}: none, ${HEAT_LABELS.join(', ')}` })}
    >
      <span>none</span><i data-heat="0"></i>${HEAT_LABELS.map(
        (l, i) => html`<i data-heat="${i + 1}" title="${l}"></i>`,
      )}<span>${HEAT_LABELS[HEAT_LABELS.length - 1]}</span>
    </div>`;

  // --- Strip and brush: counts per step, with a selected range to drag ----------

  /** The step index under `x` on a strip `width` wide with `count` steps, clamped. */
  const stripIndex = (x, width, count) =>
    Math.min(count - 1, Math.max(0, Math.floor((x / (width || 1)) * count)));

  /**
   * A strip of bars, one per step, with the selected range [a, b] outlined.
   * `labels` is a list of { index, text } written under the bars.
   */
  function strip({ counts, width, height, selected, labels = [], label }) {
    const max = Math.max(1, ...counts);
    const step = width / Math.max(1, counts.length);
    const barH = height - 16;
    const bars = counts.map((c, i) => {
      if (!c) return '';
      const h = Math.max(2, (c / max) * (barH - 4));
      return html`<rect
        class="ar-strip-bar"
        x="${n(i * step + 1)}"
        y="${n(barH - h)}"
        width="${n(Math.max(1, step - 2))}"
        height="${n(h)}"
      ></rect>`;
    });
    const [a, b] = selected || [0, counts.length - 1];
    const sel = html`<rect
      class="ar-strip-sel"
      x="${n(a * step)}"
      y="0"
      width="${n((b - a + 1) * step)}"
      height="${n(barH)}"
    ></rect>`;
    const texts = labels.map((l, k) =>
      text({
        x: (l.index + 0.5) * step,
        y: height - 2,
        value: l.text,
        anchor: k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle',
        cls: 'ar-chart-axis',
      }),
    );
    return svg({
      width,
      height,
      label,
      attrs: { class: 'ar-strip', 'data-steps': counts.length },
      body: html`${bars}${sel}${texts}`,
    });
  }

  /**
   * Makes a strip from `strip()` draggable: dragging outlines a range, and on
   * release `onPick([a, b])` gets it (a single click picks the whole strip).
   */
  function brush(svgEl, onPick) {
    if (!svgEl) return;
    const steps = Number(svgEl.dataset.steps) || 1;
    const sel = svgEl.querySelector('.ar-strip-sel');
    const width = svgEl.viewBox.baseVal.width;
    const at = (ev) => {
      const r = svgEl.getBoundingClientRect();
      return stripIndex(((ev.clientX - r.left) / (r.width || 1)) * width, width, steps);
    };
    let start = null;
    svgEl.addEventListener('pointerdown', (ev) => {
      start = at(ev);
      svgEl.setPointerCapture(ev.pointerId);
    });
    svgEl.addEventListener('pointermove', (ev) => {
      if (start === null) return;
      const i = at(ev);
      const step = width / steps;
      sel.setAttribute('x', String(Math.min(start, i) * step));
      sel.setAttribute('width', String((Math.abs(i - start) + 1) * step));
    });
    svgEl.addEventListener('pointerup', (ev) => {
      if (start === null) return;
      const i = at(ev);
      const a = Math.min(start, i);
      const b = Math.max(start, i);
      start = null;
      onPick(a === b ? [0, steps - 1] : [a, b]);
    });
  }

  /** A length token in pixels, read from the page (for SVG geometry); `fallback` outside a page. */
  function px(name, fallback) {
    if (typeof document === 'undefined') return fallback;
    const style = getComputedStyle(document.documentElement);
    const value = style.getPropertyValue(`--ar-${name}`).trim();
    const v = parseFloat(value);
    if (!Number.isFinite(v)) return fallback;
    return /rem$/.test(value) ? v * (parseFloat(style.fontSize) || 16) : v;
  }

  AR.chart = {
    ticks,
    scaleLinear,
    scaleBand,
    scaleTime,
    svg,
    line,
    rect,
    circle,
    text,
    path,
    axisBottom,
    axisLeft,
    slots,
    legendFor,
    heatStep,
    HEAT_LABELS,
    heatCell,
    stripIndex,
    strip,
    brush,
    px,
    raw,
  };
  AR.HeatRamp = HeatRamp;
})((globalThis.AR ??= {}));
