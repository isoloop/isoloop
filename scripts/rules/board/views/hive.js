// The Hive tab (ADR 0026, amended 2026-11-28): a hive plot. One axis per
// concept, a dot per rule ordered from its first event (centre) to its newest
// (tip) and toned by status, and the model's links drawn as curves between
// axes. Hovering a dot or an axis traces its links; clicking a dot opens it.
// The plot is drawn in mount(), at the size of its box, so one SVG unit is one
// pixel and the type scale holds at every width.
(() => {
  const KINDS = [
    { id: 'related', label: 'Related', note: 'Written by hand: related and superseded by' },
    { id: 'section', label: 'Same ADR section', note: 'Derived: both cite the same ADR heading' },
    { id: 'symbol', label: 'Shared symbol', note: 'Derived: the same name, knob or error' },
    { id: 'code', label: 'Shared code path', note: 'Derived: the same file in `code`' },
  ];
  const KIND_SLOT = Object.fromEntries(KINDS.map((k, i) => [k.id, i + 1]));
  const KIND_NAME = Object.fromEntries(KINDS.map((k) => [k.id, k.label]));

  // What the reader turned on: link kinds, and links inside one concept (off by default).
  let kinds = null;
  let inside = null;
  const kindsOf = (ctx) => {
    if (kinds) return kinds;
    const saved = ctx.load('ar-hive-kinds');
    kinds = new Set(saved === null ? KINDS.map((k) => k.id) : saved.split(',').filter(Boolean));
    return kinds;
  };
  const insideOf = (ctx) => (inside ??= ctx.load('ar-hive-inside') === '1');

  const firstDate = (r) => r.events.reduce((m, e) => (e.date < m ? e.date : m), '9999-12-31');

  /** The visible rules, the axes they sit on and the links between them, for the current filters. */
  function model(ctx) {
    const visible = ctx.rules.filter(ctx.matches);
    const shown = new Set(visible.map((r) => r.id));
    const axes = ctx.concepts.filter((c) => visible.some((r) => r.concept === c.id));
    const on = kindsOf(ctx);
    const withInside = insideOf(ctx);
    const conceptOf = (id) => ctx.byId[id].concept;
    const all = ctx.model.links.filter((l) => shown.has(l.a) && shown.has(l.b));
    const links = all.filter(
      (l) => on.has(l.kind) && (withInside || conceptOf(l.a) !== conceptOf(l.b)),
    );
    const counts = Object.fromEntries(KINDS.map((k) => [k.id, { all: 0, across: 0 }]));
    for (const l of all) {
      counts[l.kind].all++;
      if (conceptOf(l.a) !== conceptOf(l.b)) counts[l.kind].across++;
    }
    return { visible, axes, links, counts };
  }

  /** Geometry for a box `width` wide: each axis's angle, each dot's place and size. */
  function layout(ctx, m, width) {
    const { px, polar } = AR.chart;
    const narrow = width < 2 * px('col-min', 288);
    const height = Math.min(width, px('plot-max', 896));
    // Room for the labels: two text lines above and below, a label's width at the sides.
    const line = px('text-xs', 11) * 1.4;
    const gap = px('space-5', 12);
    const longest = Math.max(...m.axes.map((c) => (narrow ? c.prefix : `${c.name} 000`).length), 1);
    const labelW = longest * px('text-xs', 11) * 0.62;
    const r1 = Math.max(
      px('space-10', 48),
      Math.min(height / 2 - 2 * line - gap, width / 2 - labelW - gap),
    );
    const r0 = r1 * 0.16;
    const angle = {};
    m.axes.forEach((c, i) => (angle[c.id] = -Math.PI / 2 + (2 * Math.PI * i) / m.axes.length));
    const pos = {};
    const dotMax = px('dot', 8) / 2 + px('space-1', 2);
    const dotMin = px('hairline', 1) * 1.5;
    for (const c of m.axes) {
      const list = m.visible
        .filter((r) => r.concept === c.id)
        .sort((a, b) => firstDate(a).localeCompare(firstDate(b)) || a.id.localeCompare(b.id));
      const size = Math.max(dotMin, Math.min(dotMax, ((r1 - r0) / list.length) * 0.42));
      list.forEach((r, k) => {
        const rad = r0 + ((k + 0.5) / list.length) * (r1 - r0);
        pos[r.id] = { r: rad, a: angle[c.id], xy: polar(rad, angle[c.id]), size };
      });
    }
    return { width, height, r0, r1, angle, pos, narrow, line, gap };
  }

  /** A curve from p to q bending around the centre; a loop to one side on the same axis. */
  function curve(p, q, g) {
    const { polar } = AR.chart;
    const [x1, y1] = p.xy;
    const [x2, y2] = q.xy;
    let c1;
    let c2;
    if (p.a === q.a) {
      const off = 0.12 + (0.5 * Math.abs(p.r - q.r)) / (g.r1 - g.r0 || 1);
      c1 = polar(p.r, p.a + off);
      c2 = polar(q.r, q.a + off);
    } else {
      let d = q.a - p.a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      c1 = polar(p.r, p.a + d / 3);
      c2 = polar(q.r, q.a - d / 3);
    }
    return `M${x1},${y1}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`;
  }

  /** The SVG for model `m` at geometry `g`. */
  function plot(ctx, m, g) {
    const { html } = AR;
    const ch = AR.chart;
    const axes = m.axes.map((c) => {
      const a = g.angle[c.id];
      const [x0, y0] = ch.polar(g.r0 - g.gap, a);
      const [x1, y1] = ch.polar(g.r1 + g.gap / 2, a);
      const [lx, ly] = ch.polar(g.r1 + g.gap * 1.5, a);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
      const dy = sin > 0.6 ? g.line * 0.7 : sin < -0.6 ? 0 : g.line * 0.3;
      const count = m.visible.filter((r) => r.concept === c.id).length;
      return html`<g class="ar-hive-axis-g" data-c="${c.id}">
        ${ch.line({ x1: x0, y1: y0, x2: x1, y2: y1, cls: 'ar-hive-axis' })}
        ${ch.line({ x1: x0, y1: y0, x2: x1, y2: y1, cls: 'ar-hive-axis-hit' })}
        ${ch.text({
          x: lx,
          y: ly + dy,
          anchor,
          cls: 'ar-hive-label',
          value: g.narrow
            ? c.prefix
            : html`${c.name} <tspan class="ar-hive-count">${count}</tspan>`,
          attrs: { 'data-c': c.id },
        })}
      </g>`;
    });
    const links = m.links.map((l, k) =>
      ch.path({
        d: curve(g.pos[l.a], g.pos[l.b], g),
        slot: KIND_SLOT[l.kind],
        cls: 'ar-hive-link',
        attrs: { 'data-k': k },
      }),
    );
    const dots = m.visible.map((r) =>
      ch.circle({
        cx: g.pos[r.id].xy[0],
        cy: g.pos[r.id].xy[1],
        r: g.pos[r.id].size,
        tone: ctx.STATUS_TONE[r.status],
        cls: 'ar-chart-mark ar-hive-dot',
        attrs: { 'data-id': r.id, 'data-dim': ctx.DIM.includes(r.status) },
      }),
    );
    const svg = ch.svg({
      width: g.width,
      height: g.height,
      label: `Hive plot: ${m.axes.length} concepts as axes, ${m.visible.length} rules as dots, ${m.links.length} links`,
      body: html`<g transform="translate(${g.width / 2} ${g.height / 2})">
        ${axes}${links}${dots}
      </g>`,
    });
    return svg;
  }

  // The side panel's summary, and what it shows while a dot or an axis is in focus.
  function summary(ctx, m) {
    const { html } = AR;
    const across = m.links.filter((l) => ctx.byId[l.a].concept !== ctx.byId[l.b].concept).length;
    return html`<p>
        <b>${m.axes.length} concepts, ${m.visible.length} rules, ${m.links.length} links shown</b>
        (${across} across concepts).
      </p>
      <p class="ar-hive-hint">
        Each axis is a concept, with its oldest rule at the centre and its newest at the tip. Hover
        a dot or an axis to trace its links; click a dot to open the rule.
      </p>`;
  }
  function ruleFocus(ctx, r, neighbours) {
    const { html, md } = AR;
    const per = {};
    const reach = new Set();
    for (const { other, kind } of neighbours) {
      per[kind] = (per[kind] || 0) + 1;
      if (other.concept !== r.concept) reach.add(ctx.cName[other.concept]);
    }
    const list = KINDS.filter((k) => per[k.id]);
    return html`<p class="ar-hive-id">${r.id}</p>
      <p>${md(r.statement)}</p>
      ${AR.Legend({
        label: 'Links of this rule',
        items: list.length
          ? list.map((k) => ({ label: k.label, slot: KIND_SLOT[k.id], value: per[k.id] }))
          : [{ label: 'No links shown', slot: 'other' }],
      })}
      ${reach.size ? html`<p class="ar-hive-hint">Reaches ${[...reach].join(', ')}</p>` : ''}`;
  }
  function conceptFocus(ctx, id, per) {
    const { html } = AR;
    const list = Object.entries(per).sort((a, b) => b[1] - a[1]);
    const total = list.reduce((s, [, n]) => s + n, 0);
    return html`<p><b>${ctx.cName[id]}</b>: ${total} links to other concepts</p>
      ${
        list.length
          ? AR.Table({
              columns: [
                { key: 'c', label: 'Concept' },
                { key: 'n', label: 'Links', align: 'end' },
              ],
              rows: list.map(([c, n]) => ({ c: ctx.cName[c], n })),
            })
          : AR.EmptyState({ text: 'None shown.' })
      }`;
  }

  let observer = null;

  Rules.view({
    id: 'hive',
    label: 'Hive',
    order: 30,
    onClick(e, ctx) {
      const k = e.target.closest('[data-hive-kind]');
      const i = e.target.closest('[data-hive-inside]');
      if (!k && !i) return false;
      if (k) {
        const on = kindsOf(ctx);
        const id = k.dataset.hiveKind;
        on.has(id) ? on.delete(id) : on.add(id);
        ctx.save('ar-hive-kinds', [...on].join(','));
      } else {
        inside = !insideOf(ctx);
        ctx.save('ar-hive-inside', inside ? '1' : '0');
      }
      ctx.render();
      return true;
    },
    render(ctx) {
      const { html, md } = AR;
      if (!ctx.rules.length) return AR.EmptyState({ text: 'No rules yet.', size: 'l' });
      const m = model(ctx);
      if (!m.visible.length) return AR.EmptyState({ text: 'No rules match.', size: 'l' });
      const on = kindsOf(ctx);
      const kindChips = KINDS.map((k) =>
        AR.Chip({
          label: html`<span class="ar-hive-kind"
            >${k.label}<span class="ar-hive-note">${md(k.note)}</span></span
          >`,
          pressed: on.has(k.id),
          count: `${m.counts[k.id].across} across · ${m.counts[k.id].all}`,
          slot: KIND_SLOT[k.id],
          attrs: { 'data-hive-kind': k.id },
        }),
      );
      const tooCommon = ctx.model.tooCommon.filter((t) => KIND_NAME[t.kind]);
      const cap = (ctx.config.links && ctx.config.links.cap) || 12;
      const note = tooCommon.length
        ? html`<b>Too common to draw</b> (shared by more than ${cap} rules):
            ${AR.join(
              tooCommon.map((t) => html`<code>${t.key}</code> (${KIND_NAME[t.kind]}, ${t.rules})`),
              ', ',
            )}`
        : '';
      const statuses = Object.keys(ctx.STATUS).filter((s) => ctx.state.on.has(s));
      return AR.Split({
        gap: '7',
        side: 'panel',
        children: html`<aside class="ar-hive-side ar-stack" style="--ar-gap: var(--ar-space-6)">
            <div class="ar-hive-info ar-stack" id="ar-hive-info" aria-live="polite">
              ${summary(ctx, m)}
            </div>
            <section class="ar-stack">
              <h3 class="ar-hive-h">Links · across concepts · all</h3>
              ${AR.Stack({
                gap: '3',
                children: [
                  ...kindChips,
                  AR.Chip({
                    label: html`<span class="ar-hive-kind"
                      >Links inside a concept<span class="ar-hive-note"
                        >Off by default: they hug each axis</span
                      ></span
                    >`,
                    pressed: insideOf(ctx),
                    attrs: { 'data-hive-inside': '1' },
                  }),
                ],
              })}
            </section>
            <section class="ar-stack">
              <h3 class="ar-hive-h">Dots</h3>
              ${AR.Legend({
                label: 'Status',
                items: statuses.map((s) => ({ label: ctx.STATUS[s], tone: ctx.STATUS_TONE[s] })),
              })}
            </section>
          </aside>
          ${AR.ChartFrame({
            title: 'How rules connect across concepts',
            sub: 'One axis per concept; curves are links between rules.',
            body: html`<div class="ar-hive-plot" id="ar-hive-plot"></div>`,
            note,
          })}`,
      });
    },
    mount(ctx) {
      const box = document.getElementById('ar-hive-plot');
      if (!box) return;
      if (observer) observer.disconnect();
      const m = model(ctx);
      let drawn = 0;
      const draw = () => {
        const width = Math.floor(box.clientWidth);
        if (!width || width === drawn) return;
        drawn = width;
        const g = layout(ctx, m, width);
        box.innerHTML = String(plot(ctx, m, g));
        wire(ctx, m, box.querySelector('svg'));
      };
      draw();
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(draw);
        observer.observe(box);
      }
    },
  });

  /** Hover: trace a dot's or an axis's links and describe them in the side panel. */
  function wire(ctx, m, svg) {
    if (!svg) return;
    const info = document.getElementById('ar-hive-info');
    const paths = svg.querySelectorAll('.ar-hive-link');
    const dots = new Map([...svg.querySelectorAll('.ar-hive-dot')].map((d) => [d.dataset.id, d]));
    const labels = svg.querySelectorAll('.ar-hive-label');
    const adj = new Map();
    m.links.forEach((l, k) => {
      for (const [x, y] of [
        [l.a, l.b],
        [l.b, l.a],
      ]) {
        if (!adj.has(x)) adj.set(x, []);
        adj.get(x).push({ other: y, k, kind: l.kind });
      }
    });
    const hot = (el) => el && el.setAttribute('data-hot', '');
    const clear = () => {
      svg.removeAttribute('data-focus');
      svg.querySelectorAll('[data-hot]').forEach((el) => el.removeAttribute('data-hot'));
      if (info) info.innerHTML = String(summary(ctx, m));
    };
    const focusRule = (id) => {
      clear();
      svg.setAttribute('data-focus', '');
      const r = ctx.byId[id];
      hot(dots.get(id));
      const near = adj.get(id) || [];
      for (const { other, k } of near) {
        hot(paths[k]);
        hot(dots.get(other));
      }
      labels.forEach((t) => t.dataset.c === r.concept && hot(t));
      if (info)
        info.innerHTML = String(
          ruleFocus(
            ctx,
            r,
            near.map((x) => ({ other: ctx.byId[x.other], kind: x.kind })),
          ),
        );
    };
    const focusConcept = (c) => {
      clear();
      svg.setAttribute('data-focus', '');
      const per = {};
      m.links.forEach((l, k) => {
        const ca = ctx.byId[l.a].concept;
        const cb = ctx.byId[l.b].concept;
        if (ca === cb || (ca !== c && cb !== c)) return;
        hot(paths[k]);
        hot(dots.get(l.a));
        hot(dots.get(l.b));
        const o = ca === c ? cb : ca;
        per[o] = (per[o] || 0) + 1;
      });
      labels.forEach((t) => t.dataset.c === c && hot(t));
      if (info) info.innerHTML = String(conceptFocus(ctx, c, per));
    };
    const target = (el) =>
      el && el.closest && (el.closest('.ar-hive-dot') || el.closest('.ar-hive-axis-g'));
    svg.addEventListener('pointerover', (e) => {
      const d = e.target.closest('.ar-hive-dot');
      if (d) return focusRule(d.dataset.id);
      const g = e.target.closest('.ar-hive-axis-g');
      if (g) focusConcept(g.dataset.c);
    });
    svg.addEventListener('pointerout', (e) => {
      if (target(e.target) && !target(e.relatedTarget)) clear();
    });
  }
})();
