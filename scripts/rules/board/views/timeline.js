// The Timeline tab (ADR 0026, amended 2026-11-28): every event of every rule, one
// lane per concept and one column per day, with the releases marked; and Churn,
// the amended, clarified and corrected events per concept per day as a heatmap.
// Geometry comes from the design system's tokens (read with AR.chart.px), dates
// from AR.chart.scaleTime, colours from the event families and the heat ramp.
(() => {
  const { html, md } = AR;
  const CHURN = ['amended', 'clarified', 'corrected'];

  // View state, kept across renders.
  let mode = null; // 'timeline' | 'churn'
  let span = null; // [first, last] day index on the timeline
  let typeOn = null; // the event types shown on the timeline
  let churnSort = 'busy';
  let churnSel = null; // 'concept|day' of the selected churn cell
  let model = null;
  let lastCtx = null;

  const addDay = (d, n) => {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /** Events, days, lanes and releases, computed once from the data. */
  function modelOf(ctx) {
    if (model) return model;
    const events = [];
    ctx.rules.forEach((r) => r.events.forEach((e) => events.push({ r, e })));
    const dates = events.map((x) => x.e.date).sort();
    const first = dates[0] || new Date().toISOString().slice(0, 10);
    const last = dates[dates.length - 1] || first;
    const days = [];
    for (let d = first; d <= last; d = addDay(d, 1)) days.push(d);
    const dayIx = Object.fromEntries(days.map((d, i) => [d, i]));
    const lanes = ctx.concepts.filter((c) => ctx.rules.some((r) => r.concept === c.id));
    const releases = [
      ...new Map(
        events.filter((x) => x.e.type === 'shipped').map((x) => [x.e.ref, x.e.date]),
      ).entries(),
    ]
      .map(([tag, date]) => ({ tag, date }))
      .sort((a, b) => a.date.localeCompare(b.date));
    model = { events, days, dayIx, lanes, releases };
    return model;
  }

  const modeOf = (ctx) =>
    (mode ??= ctx.load('ar-timeline-mode') === 'churn' ? 'churn' : 'timeline');
  // Shipped events are off at first: they all sit on release days, and the release lines stand for them.
  const typesOf = () => (typeOn ??= new Set(AR.events.ORDER.filter((t) => t !== 'shipped')));
  const spanOf = (m) => (span ??= [0, m.days.length - 1]);

  const dLong = (d) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const dShort = (d) => String(new Date(d + 'T00:00:00').getDate());

  // --- Shared pieces -------------------------------------------------------------

  /** The tab's outer frame: a stack inside the element that marks this view. */
  const frame = (children) =>
    html`<div class="ar-timeline">${AR.Stack({ gap: '6', children })}</div>`;

  /** The lane labels: a header row, then one row per lane, each `heights[i]` tall. */
  const labelsHtml = (lanes, heights, top, counts, head) =>
    html`<div class="ar-timeline-label" data-head style="height: ${top}px">
        <span class="ar-timeline-count">${head}</span>
      </div>
      ${lanes.map(
        (c, i) =>
          html`<div class="ar-timeline-label" style="height: ${heights[i]}px">
            <span class="ar-timeline-name" title="${c.name}">${c.name}</span
            ><span class="ar-timeline-prefix">${c.prefix}</span
            ><span class="ar-timeline-count">${counts[i]}</span>
          </div>`,
      )}`;

  /** Day labels along the top, from a time scale; every `every` days, plus the first. */
  function dayAxis(days, scale, every, y) {
    return days.map((d, i) =>
      i % every === 0 || d.endsWith('-01')
        ? AR.chart.text({
            x: scale(d),
            y,
            value: i === 0 || d.endsWith('-01') ? dLong(d) : dShort(d),
            anchor: 'middle',
            cls: 'ar-chart-axis',
          })
        : '',
    );
  }

  /** Release lines across the plot, labels at the top lifted when two are close. */
  function releaseLines(releases, scale, inRange, top, bottom) {
    let lastX = -Infinity;
    let lift = 0;
    return releases.filter(inRange).map((rel) => {
      const x = scale(rel.date);
      lift = x - lastX < 56 ? (lift ? 0 : 12) : 0;
      lastX = x;
      return html`${AR.chart.line({ x1: x, y1: top - 4, x2: x, y2: bottom, cls: 'ar-timeline-release' })}${AR.chart.text(
        { x: x + 3, y: 12 + lift, value: rel.tag, cls: 'ar-timeline-release-label' },
      )}`;
    });
  }

  // --- Timeline ------------------------------------------------------------------

  function timelineEvents(ctx, m) {
    const [a, b] = spanOf(m);
    const on = typesOf();
    return m.events.filter(
      (x) =>
        on.has(x.e.type) && ctx.matches(x.r) && m.dayIx[x.e.date] >= a && m.dayIx[x.e.date] <= b,
    );
  }

  function presets(m) {
    const n = m.days.length - 1;
    const list = [
      { label: 'All', a: 0, b: n },
      { label: 'Last 7 days', a: Math.max(0, n - 6), b: n },
      { label: 'Last 14 days', a: Math.max(0, n - 13), b: n },
    ];
    const rel = m.releases[0] && m.dayIx[m.releases[0].date];
    if (rel !== undefined)
      list.push({
        label: `Week of ${m.releases[0].tag}`,
        a: Math.max(0, rel - 3),
        b: Math.min(n, rel + 3),
      });
    return list;
  }

  function renderTimeline(ctx, m) {
    const evs = timelineEvents(ctx, m);
    const [a, b] = spanOf(m);
    const counts = {};
    m.events
      .filter((x) => ctx.matches(x.r))
      .forEach((x) => (counts[x.e.type] = (counts[x.e.type] || 0) + 1));
    const on = typesOf();
    return frame(
      html`<p class="ar-timeline-sum">
          <b>${evs.length}</b> events from <b>${dLong(m.days[a])}</b> to <b>${dLong(m.days[b])}</b>,
          one lane per concept. Each mark is one event on one rule: hover for its why, click to open
          the
          rule.${on.has('shipped') ? '' : ' Shipped events are off at first: the release lines stand for them.'}
        </p>
        ${AR.Toolbar({
          label: 'Date range',
          children: html`${presets(m).map((p) =>
              AR.Chip({
                label: p.label,
                pressed: a === p.a && b === p.b,
                attrs: { 'data-span': `${p.a},${p.b}` },
              }),
            )}<span class="ar-timeline-range"
              >${plural(b - a + 1, 'day')} · drag on the strip to zoom</span
            >`,
        })}
        <div class="ar-timeline-strip" id="ar-timeline-strip"></div>
        ${AR.Toolbar({
          label: 'Event types',
          children: AR.events.ORDER.filter((t) => counts[t]).map((t) =>
            AR.Chip({
              label: AR.events.typeOf(t).label,
              pressed: on.has(t),
              count: counts[t],
              icon: AR.EventIcon({ type: t }),
              attrs: { 'data-et': t },
            }),
          ),
        })}
        <div class="ar-timeline-chart" id="ar-timeline-chart">
          <div class="ar-timeline-labels"></div>
          <div class="ar-timeline-scroll"></div>
        </div>`,
    );
  }

  function mountTimeline(ctx, m) {
    const chart = document.getElementById('ar-timeline-chart');
    const stripHost = document.getElementById('ar-timeline-strip');
    if (!chart || !stripHost) return;
    const [a, b] = spanOf(m);
    const on = typesOf();

    // The strip: events per day over the whole history, with the range outlined.
    const perDay = m.days.map(() => 0);
    m.events.forEach((x) => {
      if (on.has(x.e.type) && ctx.matches(x.r)) perDay[m.dayIx[x.e.date]]++;
    });
    const last = m.days.length - 1;
    stripHost.innerHTML = String(
      AR.chart.strip({
        counts: perDay,
        width: Math.max(240, stripHost.clientWidth),
        height: AR.chart.px('strip-height', 56),
        selected: [a, b],
        labels: [
          { index: 0, text: dLong(m.days[0]) },
          { index: Math.floor(last / 2), text: dLong(m.days[Math.floor(last / 2)]) },
          { index: last, text: dLong(m.days[last]) },
        ],
        label: 'Events per day; drag to pick a date range',
      }),
    );
    AR.chart.brush(stripHost.querySelector('svg'), (pick) => {
      span = pick;
      ctx.render();
    });

    // The lanes.
    const labelsEl = chart.querySelector('.ar-timeline-labels');
    const scrollEl = chart.querySelector('.ar-timeline-scroll');
    const days = m.days.slice(a, b + 1);
    const nd = days.length;
    const pitch = AR.chart.px('symbol-pitch', 10);
    const size = AR.chart.px('symbol', 8);
    const lanePad = AR.chart.px('lane-pad', 14);
    const top = AR.chart.px('axis-band', 50);
    const labelW = labelsEl.getBoundingClientRect().width;
    const avail = Math.max(240, chart.clientWidth - labelW - 2);
    const dayW = Math.max(AR.chart.px('day-min', 30), Math.floor(avail / nd));
    const W = nd * dayW;
    const x = AR.chart.scaleTime([days[0], days[nd - 1]], [dayW / 2, W - dayW / 2]);
    const cols = Math.max(1, Math.floor((dayW - 6) / pitch));

    const byLane = new Map(m.lanes.map((c) => [c.id, new Map()]));
    timelineEvents(ctx, m).forEach((ev) => {
      const lane = byLane.get(ev.r.concept);
      if (!lane) return;
      if (!lane.has(ev.e.date)) lane.set(ev.e.date, []);
      lane.get(ev.e.date).push(ev);
    });
    let y = top;
    const bands = [];
    const marks = [];
    const heights = [];
    const counts = [];
    m.lanes.forEach((c, li) => {
      const lane = byLane.get(c.id);
      let rows = 1;
      let total = 0;
      lane.forEach((list) => {
        rows = Math.max(rows, Math.ceil(list.length / cols));
        total += list.length;
      });
      const h = rows * pitch + lanePad;
      heights.push(h);
      counts.push(total);
      if (li % 2 === 1)
        bands.push(
          AR.chart.rect({ x: 0, y, width: W, height: h, cls: 'ar-timeline-band', slot: null }),
        );
      bands.push(AR.chart.line({ x1: 0, y1: y, x2: W, y2: y }));
      lane.forEach((list, d) => {
        list.sort(
          (p, q) =>
            AR.events.ORDER.indexOf(p.e.type) - AR.events.ORDER.indexOf(q.e.type) ||
            p.r.id.localeCompare(q.r.id),
        );
        const x0 = x(d) - (cols * pitch) / 2;
        list.forEach((ev, k) => {
          const cx = x0 + (k % cols) * pitch + pitch / 2;
          const cy = y + lanePad / 2 + Math.floor(k / cols) * pitch + pitch / 2;
          const i = m.events.indexOf(ev);
          marks.push(
            html`<g class="ar-timeline-mark" data-id="${ev.r.id}" data-ev="${i}">
              ${AR.chart.rect({ x: cx - pitch / 2, y: cy - pitch / 2, width: pitch, height: pitch, cls: 'ar-timeline-hit', slot: null })}${AR.events.eventSymbol({ type: ev.e.type, cx, cy, size })}
            </g>`,
          );
        });
      });
      y += h;
    });
    const grid = days
      .slice(1)
      .map((d) => AR.chart.line({ x1: x(d) - dayW / 2, y1: top, x2: x(d) - dayW / 2, y2: y }));
    const every = dayW >= 26 ? 1 : dayW >= 13 ? 2 : 4;
    const inRange = (rel) => m.dayIx[rel.date] >= a && m.dayIx[rel.date] <= b;
    scrollEl.innerHTML = String(
      AR.chart.svg({
        width: W,
        height: y,
        label: 'Rule events per concept per day',
        attrs: { width: W, height: y, class: 'ar-timeline-svg' },
        body: html`${bands}${grid}${dayAxis(days, x, every, top - 8)}${releaseLines(m.releases, x, inRange, top, y)}${marks}`,
      }),
    );
    labelsEl.innerHTML = String(labelsHtml(m.lanes, heights, top, counts, 'Concept'));

    scrollEl.addEventListener('pointerover', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const mk = ev.target.closest('.ar-timeline-mark');
      if (!mk) return AR.tooltip.hide();
      const { r, e } = m.events[Number(mk.dataset.ev)];
      AR.tooltip.show(
        html`<div class="ar-stack">
          ${AR.Cluster({ gap: '3', children: html`<b>${r.id}</b>${ctx.eventLabel(e.type)}<span class="ar-timeline-date">${e.date}</span>` })}
          <p>${md(e.why)}</p>
        </div>`,
        ev.clientX,
        ev.clientY,
      );
    });
    scrollEl.addEventListener('pointerleave', () => AR.tooltip.hide());
  }

  // --- Churn ---------------------------------------------------------------------

  function churnData(ctx, m) {
    const cells = new Map();
    const totals = Object.fromEntries(m.lanes.map((c) => [c.id, 0]));
    const perDay = m.days.map(() => 0);
    m.events.forEach((x) => {
      if (!CHURN.includes(x.e.type) || !ctx.matches(x.r)) return;
      const k = x.r.concept + '|' + x.e.date;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(x);
      if (totals[x.r.concept] !== undefined) totals[x.r.concept]++;
      perDay[m.dayIx[x.e.date]]++;
    });
    return { cells, totals, perDay };
  }

  const churnLanes = (m, totals) => {
    const lanes = [...m.lanes];
    if (churnSort === 'busy')
      lanes.sort((p, q) => totals[q.id] - totals[p.id] || (p.order ?? 0) - (q.order ?? 0));
    return lanes;
  };

  function renderChurn(ctx, m) {
    const { cells, totals } = churnData(ctx, m);
    const all = [...cells.values()].flat();
    const nT = (t) => all.filter((x) => x.e.type === t).length;
    const hot = [...cells.entries()].sort((p, q) => q[1].length - p[1].length)[0];
    const split = (k) => k.split('|');
    const detail = churnSel && cells.get(churnSel);
    const rows = [...cells.entries()]
      .sort((p, q) => q[1].length - p[1].length || p[0].localeCompare(q[0]))
      .map(([k, list]) => ({
        concept: ctx.cName[split(k)[0]] || split(k)[0],
        day: split(k)[1],
        n: list.length,
        rules: [...new Set(list.map((x) => x.r.id))].join(', '),
      }));
    return frame(
      html`<p class="ar-timeline-sum">
          <b>${all.length}</b> changes to existing rules (${nT('amended')} amended,
          ${nT('clarified')} clarified, ${nT('corrected')} corrected), per concept per
          day.${
            hot
              ? html` The busiest cell is <b>${ctx.cName[split(hot[0])[0]]}</b> on
                  <b>${dLong(split(hot[0])[1])}</b> (${hot[1].length}).`
              : ''
          }
        </p>
        ${AR.Toolbar({
          label: 'Churn',
          children: html`${AR.Tabs({
            items: [
              { id: 'busy', label: 'Busiest first' },
              { id: 'order', label: 'Concept order' },
            ],
            selected: churnSort,
            role: 'radio',
            key: 'sort',
            label: 'Row order',
          })}${AR.HeatRamp({ label: 'Changes per cell' })}`,
        })}
        <div class="ar-timeline-chart" id="ar-timeline-churn" data-totals>
          <div class="ar-timeline-labels"></div>
          <div class="ar-timeline-scroll"></div>
          <div class="ar-timeline-totals"></div>
        </div>
        ${
          detail
            ? html`<section class="ar-stack">
                <h3 class="ar-timeline-h">
                  ${ctx.cName[split(churnSel)[0]]} · ${dLong(split(churnSel)[1])} ·
                  ${plural(detail.length, 'change')}
                </h3>
                <div class="ar-timeline-rows">
                  ${detail.map(
                    (x) =>
                      html`<button class="ar-timeline-row" data-id="${x.r.id}">
                        ${ctx.eventLabel(x.e.type)}<span
                          ><b>${x.r.id}</b><span class="ar-timeline-why">${md(x.e.why)}</span></span
                        >
                      </button>`,
                  )}
                </div>
              </section>`
            : html`<p class="ar-timeline-sum">Click a coloured cell to list its changes here.</p>`
        }
        <details class="ar-timeline-table">
          <summary>Table view</summary>
          ${AR.Table({
            columns: [
              { key: 'concept', label: 'Concept' },
              { key: 'day', label: 'Day' },
              { key: 'n', label: 'Changes', align: 'end' },
              { key: 'rules', label: 'Rules' },
            ],
            rows,
          })}
        </details>`,
    );
  }

  function mountChurn(ctx, m) {
    const chart = document.getElementById('ar-timeline-churn');
    if (!chart) return;
    const { cells, totals, perDay } = churnData(ctx, m);
    const lanes = churnLanes(m, totals);
    const labelsEl = chart.querySelector('.ar-timeline-labels');
    const scrollEl = chart.querySelector('.ar-timeline-scroll');
    const totalsEl = chart.querySelector('.ar-timeline-totals');
    const top = AR.chart.px('axis-band', 50);
    const ch = AR.chart.px('heat-cell', 26);
    const nd = m.days.length;
    const avail = Math.max(
      240,
      chart.clientWidth -
        labelsEl.getBoundingClientRect().width -
        totalsEl.getBoundingClientRect().width -
        4,
    );
    const cw = Math.max(AR.chart.px('heat-cell-min', 24), Math.floor(avail / nd));
    const W = nd * cw;
    const x = AR.chart.scaleTime([m.days[0], m.days[nd - 1]], [cw / 2, W - cw / 2]);
    const cellsSvg = lanes.map((c, li) =>
      m.days.map((d) => {
        const k = c.id + '|' + d;
        const list = cells.get(k) || [];
        return AR.chart.heatCell({
          x: x(d) - cw / 2 + 1,
          y: top + li * ch + 1,
          width: cw - 2,
          height: ch - 2,
          count: list.length,
          showCount: cw >= 20,
          attrs: list.length
            ? { 'data-cell': k, role: 'button', 'aria-selected': String(churnSel === k) }
            : null,
        });
      }),
    );
    // A row of totals per day under the grid.
    const yAll = top + lanes.length * ch + 6;
    const barMax = Math.max(1, ...perDay);
    const dayBars = m.days.map((d, i) => {
      if (!perDay[i]) return '';
      const h = Math.max(2, (perDay[i] / barMax) * 30);
      return html`${AR.chart.rect({ x: x(d) - cw * 0.3, y: yAll + 40 - h, width: cw * 0.6, height: h, cls: 'ar-timeline-daybar', slot: null })}${AR.chart.text(
        {
          x: x(d),
          y: yAll + 52,
          value: perDay[i],
          anchor: 'middle',
          cls: 'ar-chart-axis',
        },
      )}`;
    });
    const H = yAll + 58;
    scrollEl.innerHTML = String(
      AR.chart.svg({
        width: W,
        height: H,
        label: 'Amended, clarified and corrected events per concept per day',
        attrs: { width: W, height: H, class: 'ar-timeline-svg' },
        body: html`${dayAxis(m.days, x, cw >= 26 ? 1 : cw >= 13 ? 2 : 4, top - 8)}${cellsSvg}${AR.chart.text(
          { x: 2, y: yAll + 14, value: 'All', cls: 'ar-chart-axis' },
        )}${dayBars}${releaseLines(m.releases, x, () => true, top, H - 20)}`,
      }),
    );
    const heights = lanes.map(() => ch);
    labelsEl.innerHTML = String(
      labelsHtml(
        lanes,
        heights,
        top,
        lanes.map((c) => totals[c.id]),
        'Concept',
      ),
    );
    const maxT = Math.max(1, ...Object.values(totals));
    totalsEl.innerHTML = String(
      html`<div class="ar-timeline-label" data-head style="height: ${top}px">
          <span class="ar-timeline-count">Total</span>
        </div>
        ${lanes.map(
          (c) =>
            html`<div
              class="ar-timeline-total"
              style="height: ${ch}px; --ar-fill: ${(totals[c.id] / maxT).toFixed(3)}"
            >
              <span class="ar-timeline-total-bar"></span><span>${totals[c.id]}</span>
            </div>`,
        )}`,
    );

    scrollEl.addEventListener('pointerover', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const cell = ev.target.closest('[data-cell]');
      if (!cell) return AR.tooltip.hide();
      const [cid, d] = cell.dataset.cell.split('|');
      const list = cells.get(cell.dataset.cell) || [];
      AR.tooltip.show(
        html`<div class="ar-stack">
          <b>${ctx.cName[cid]} · ${dLong(d)} · ${plural(list.length, 'change')}</b>
          <ul class="ar-timeline-tip-list">
            ${list.slice(0, 8).map((x) => html`<li><code>${x.r.id}</code> ${x.e.type}</li>`)}${
              list.length > 8 ? html`<li>${list.length - 8} more</li>` : ''
            }
          </ul>
        </div>`,
        ev.clientX,
        ev.clientY,
      );
    });
    scrollEl.addEventListener('pointerleave', () => AR.tooltip.hide());
  }

  // --- The view ------------------------------------------------------------------

  let resizeTimer = null;
  if (typeof window !== 'undefined')
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (lastCtx && document.querySelector('.ar-timeline')) lastCtx.render();
      }, 150);
    });

  Rules.view({
    id: 'timeline',
    label: 'Timeline',
    order: 50,
    controls(ctx) {
      return AR.Tabs({
        items: [
          { id: 'timeline', label: 'Timeline' },
          { id: 'churn', label: 'Churn' },
        ],
        selected: modeOf(ctx),
        role: 'radio',
        key: 'tl',
        label: 'Timeline view',
      });
    },
    onClick(e, ctx) {
      const t = e.target.closest('[data-tl]');
      if (t) {
        mode = t.dataset.tl;
        ctx.save('ar-timeline-mode', mode);
        AR.tooltip.hide();
        ctx.render();
        return true;
      }
      const s = e.target.closest('[data-span]');
      if (s) {
        span = s.dataset.span.split(',').map(Number);
        ctx.render();
        return true;
      }
      const et = e.target.closest('[data-et]');
      if (et) {
        const on = typesOf();
        on.has(et.dataset.et) ? on.delete(et.dataset.et) : on.add(et.dataset.et);
        ctx.render();
        return true;
      }
      const so = e.target.closest('[data-sort]');
      if (so) {
        churnSort = so.dataset.sort;
        ctx.render();
        return true;
      }
      const cell = e.target.closest('[data-cell]');
      if (cell) {
        churnSel = churnSel === cell.dataset.cell ? null : cell.dataset.cell;
        AR.tooltip.hide();
        ctx.render();
        return true;
      }
      return false;
    },
    render(ctx) {
      const m = modelOf(ctx);
      if (!m.events.length) return AR.EmptyState({ text: 'No events yet.', size: 'l' });
      return modeOf(ctx) === 'churn' ? renderChurn(ctx, m) : renderTimeline(ctx, m);
    },
    mount(ctx) {
      lastCtx = ctx;
      const m = modelOf(ctx);
      if (!m.events.length) return;
      if (modeOf(ctx) === 'churn') mountChurn(ctx, m);
      else mountTimeline(ctx, m);
    },
  });
})();
