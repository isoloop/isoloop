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
    raw,
  };
})((globalThis.AR ??= {}));
