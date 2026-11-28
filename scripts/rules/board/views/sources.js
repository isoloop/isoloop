// The Sources tab (ADR 0026, amended 2026-11-28): which ADRs feed which concepts
// (a Sankey), where the rules live in the code (a treemap), and a Health list of
// where the registry is weak. The flows, paths and checks come from the model
// built with the page; this file only lays them out.
(() => {
  const C = AR.chart;
  let mode = null;
  /** What a click picked: { kind: 'flow' | 'node' | 'path', ... }, or null. */
  let pick = null;
  /** The view's width in CSS pixels, so the SVG draws at 1:1 and text keeps its token size. */
  let width = 960;
  let listening = false;
  const modeOf = (ctx) =>
    (mode ??= ['sources', 'code', 'health'].includes(ctx.load('ar-sources'))
      ? ctx.load('ar-sources')
      : 'sources');
  const narrow = () => width < 640;
  /** Cut a label to about the characters that fit in `px` at the chart label size, or '' when none do. */
  const fit = (label, px) => {
    const max = Math.floor((px - 8) / 6.4);
    if (max < 3) return '';
    return label.length <= max ? label : label.slice(0, max - 1) + '…';
  };

  /** The rules behind a pick, as a list of buttons that open the drawer. */
  function ruleList(ctx, ids, title) {
    const { html, md } = AR;
    const rules = ids.map((id) => ctx.byId[id]).filter(Boolean);
    return html`<section class="ar-sources-picked" aria-live="polite">
      <h2 class="ar-sources-picked-title">
        ${title} · ${rules.length} rule${rules.length === 1 ? '' : 's'}
      </h2>
      <div class="ar-sources-list">
        ${rules.map(
          (r) =>
            html`<button class="ar-sources-rule" data-id="${r.id}">
              <span class="ar-sources-rule-id">${r.id}</span>
              <span class="ar-sources-rule-text">${md(r.statement)}</span>
              ${ctx.statusPill(r)}
            </button>`,
        )}
      </div>
    </section>`;
  }

  // --- Sources: ADRs into concepts --------------------------------------------

  function sourcesView(ctx) {
    const { html } = AR;
    const flows = ctx.model.sources.flows
      .map((f, i) => {
        const ids = f.rules.filter((id) => ctx.byId[id] && ctx.matches(ctx.byId[id]));
        return { i, from: f.adr, to: f.concept, type: f.type, rules: ids, value: ids.length };
      })
      .filter((f) => f.value > 0);
    if (!flows.length) return AR.EmptyState({ text: 'No rules match.' });

    const adrs = [...new Set(flows.map((f) => f.from))].sort((a, b) =>
      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
    );
    const left = adrs.map((a) => ({
      key: a,
      label: a ? (narrow() ? a : `ADR ${a}`) : narrow() ? '—' : 'No ADR',
    }));
    const right = ctx.concepts.map((c) => ({ key: c.id, label: narrow() ? c.prefix : c.name }));
    const byType = new Map();
    for (const f of flows) byType.set(f.type, (byType.get(f.type) || 0) + f.value);
    const s = C.slots([...byType].map(([key, count]) => ({ key, label: key, count })));

    const labelL = narrow() ? 52 : 84;
    const labelR = narrow() ? 56 : 180;
    const inner = Math.max(120, width - labelL - labelR);
    const height = Math.max(320, Math.max(left.length, right.length) * (narrow() ? 18 : 22));
    const lay = C.sankey({ left, right, flows, width: inner, height });
    const pickedFlow = pick?.kind === 'flow' ? pick.i : null;
    const pickedNode = pick?.kind === 'node' ? pick : null;
    const touches = (f) =>
      pickedFlow !== null
        ? f.i === pickedFlow
        : pickedNode
          ? (pickedNode.side === 'left' ? f.from : f.to) === pickedNode.key
          : null;

    const ribbons = lay.flows.map((f) => {
      const on = touches(f);
      return html`<g>
        <title>
          ${f.from ? `ADR ${f.from}` : 'No ADR'} → ${ctx.cName[f.to] || f.to}: ${f.value}
          (${f.type})
        </title>
        ${C.path({
          d: f.d,
          slot: s.slotOf(f.type),
          cls: 'ar-chart-ribbon',
          attrs: { 'data-flow': f.i, 'data-on': on === true, 'data-off': on === false },
        })}
      </g>`;
    });
    const nodes = (list, side) => {
      let last = -Infinity;
      return list.map((nd) => {
        const y = nd.y + nd.h / 2 + 4;
        const show = y - last >= 13;
        if (show) last = y;
        return html`<g class="ar-sources-node" data-node="${side}" data-key="${nd.key}">
          <title>${nd.label}: ${nd.value} rule${nd.value === 1 ? '' : 's'}</title>
          ${C.rect({ x: nd.x, y: nd.y, width: 8, height: Math.max(1, nd.h), cls: 'ar-chart-node' })}
          ${
            show
              ? C.text({
                  x: side === 'left' ? -6 : nd.x + 14,
                  y,
                  value: `${nd.label} ${nd.value}`,
                  anchor: side === 'left' ? 'end' : 'start',
                  cls: 'ar-chart-label ar-sources-node-label',
                })
              : ''
          }
        </g>`;
      });
    };
    const body = C.svg({
      width,
      height: height + 8,
      label: 'Rules flowing from each ADR into each concept',
      body: html`<g transform="translate(${labelL} 4)"
        >${ribbons}${nodes(lay.left, 'left')}${nodes(lay.right, 'right')}</g
      >`,
    });

    let picked = '';
    if (pickedFlow !== null) {
      const f = flows.find((x) => x.i === pickedFlow);
      if (f)
        picked = ruleList(
          ctx,
          f.rules,
          `${f.from ? `ADR ${f.from}` : 'No ADR'} → ${ctx.cName[f.to] || f.to} (${f.type})`,
        );
    } else if (pickedNode) {
      const ids = flows
        .filter((f) => (pickedNode.side === 'left' ? f.from : f.to) === pickedNode.key)
        .flatMap((f) => f.rules);
      const label =
        pickedNode.side === 'left'
          ? pickedNode.key
            ? `ADR ${pickedNode.key}`
            : 'No ADR'
          : ctx.cName[pickedNode.key] || pickedNode.key;
      picked = ruleList(ctx, ids, label);
    }

    return AR.Stack({
      gap: '6',
      children: html`${AR.ChartFrame({
        title: 'Where the rules come from',
        sub: 'Each band is the rules one ADR gives one concept, coloured by the first event that cites the ADR. Click a band or a name to list its rules.',
        legend: C.legendFor(s.groups, 'First event'),
        body,
      })}${picked}`,
    });
  }

  // --- Code: where the rules live ---------------------------------------------

  /** A path's group: its first two folders when it has three or more parts, else its first part. */
  const groupOf = (p) => {
    const parts = p.replace(/\/$/, '').split('/');
    if (parts.length === 1) return '(root)';
    return parts.length >= 3 ? parts.slice(0, 2).join('/') : parts[0];
  };
  const baseOf = (p) => {
    const parts = p.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] + (p.endsWith('/') ? '/' : '');
  };

  function codeView(ctx) {
    const { html } = AR;
    const paths = ctx.model.sources.code
      .map((c) => {
        const ids = c.rules.filter((id) => ctx.byId[id] && ctx.matches(ctx.byId[id]));
        return { path: c.path, rules: ids, value: ids.length };
      })
      .filter((c) => c.value > 0);
    if (!paths.length) return AR.EmptyState({ text: 'No rules with code paths match.' });

    // Colour each path by the concept that cites it most; 8 slots, the rest grouped.
    const perConcept = new Map();
    const top = (ids) => {
      const n = new Map();
      for (const id of ids) {
        const c = ctx.byId[id].concept;
        n.set(c, (n.get(c) || 0) + 1);
      }
      return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    };
    for (const p of paths) {
      p.concept = top(p.rules);
      perConcept.set(p.concept, (perConcept.get(p.concept) || 0) + p.value);
    }
    const s = C.slots(
      ctx.concepts
        .filter((c) => perConcept.has(c.id))
        .map((c) => ({ key: c.id, label: c.name, count: perConcept.get(c.id) })),
    );

    const groups = new Map();
    for (const p of paths) {
      const g = groupOf(p.path);
      if (!groups.has(g)) groups.set(g, { key: g, value: 0, paths: [] });
      const grp = groups.get(g);
      grp.value += p.value;
      grp.paths.push(p);
    }
    const height = Math.round(Math.min(640, Math.max(360, width * 0.6)));
    const head = 18;
    const outer = C.squarify([...groups.values()], { width, height });
    const cells = [];
    const heads = [];
    for (const g of outer) {
      const show = g.width > 70 && g.height > head + 12;
      if (show)
        heads.push(
          C.text({
            x: g.x + 4,
            y: g.y + 13,
            value: fit(`${g.key} ${g.value}`, g.width),
            cls: 'ar-chart-label ar-sources-group',
          }),
        );
      const box = show
        ? { x: g.x, y: g.y + head, width: g.width, height: g.height - head }
        : { x: g.x, y: g.y, width: g.width, height: g.height };
      for (const c of C.squarify(g.paths, box)) {
        const on = pick?.kind === 'path' && pick.path === c.path;
        cells.push(
          html`<g data-path="${c.path}">
            <title>
              ${c.path}: ${c.value} rule${c.value === 1 ? '' : 's'} (mostly
              ${ctx.cName[c.concept] || c.concept})
            </title>
            ${C.rect({
              x: c.x,
              y: c.y,
              width: c.width,
              height: c.height,
              slot: s.slotOf(c.concept),
              cls: 'ar-chart-cell',
              attrs: { 'data-on': on },
            })}
            ${
              c.height > 26 && fit(`${baseOf(c.path)} ${c.value}`, c.width)
                ? C.text({
                    x: c.x + 4,
                    y: c.y + 14,
                    value: fit(`${baseOf(c.path)} ${c.value}`, c.width),
                    cls: 'ar-chart-label ar-sources-cell-label',
                  })
                : ''
            }
          </g>`,
        );
      }
    }
    const body = C.svg({
      width,
      height,
      label: 'Code paths sized by the rules that cite them',
      body: html`${cells}${heads}`,
    });
    const hot = paths.slice(0, 10);
    const table = AR.Table({
      caption: 'Most cited',
      columns: [
        { key: 'path', label: 'Path' },
        { key: 'n', label: 'Rules', align: 'end' },
      ],
      rows: hot.map((p) => ({
        path: html`<button class="ar-sources-path" data-pick-path="${p.path}">${p.path}</button>`,
        n: p.value,
      })),
    });
    const picked =
      pick?.kind === 'path'
        ? (() => {
            const p = paths.find((x) => x.path === pick.path);
            return p ? ruleList(ctx, p.rules, p.path) : '';
          })()
        : '';
    return AR.Stack({
      gap: '6',
      children: html`${AR.ChartFrame({
        title: 'Where the rules live in the code',
        sub: `${paths.length} paths cited by ${new Set(paths.flatMap((p) => p.rules)).size} rules. Each cell is a path, sized by its rules and coloured by the concept that cites it most. Click one to list its rules.`,
        legend: C.legendFor(s.groups, 'Concept'),
        body,
      })}${picked}${table}`,
    });
  }

  // --- Health: where the registry is weak -------------------------------------

  function healthView(ctx) {
    const { html } = AR;
    const items = ctx.model.sources.health.map((h) => {
      const ids = h.rules
        ? h.rules.filter((id) => ctx.byId[id] && ctx.matches(ctx.byId[id]))
        : null;
      const list = ids ?? h.items ?? [];
      const count = list.length;
      const label = (x) => (h.id === 'concept-unlinked' ? ctx.cName[x] || x : x);
      const body = count
        ? html`<details class="ar-sources-details">
            <summary>Show ${count}</summary>
            <div class="ar-sources-list">
              ${
                ids
                  ? ids.map((id) => {
                      const r = ctx.byId[id];
                      return html`<button class="ar-sources-rule" data-id="${id}">
                        <span class="ar-sources-rule-id">${id}</span>
                        <span class="ar-sources-rule-text"
                          >${ctx.cName[r.concept] || r.concept}</span
                        >
                        ${ctx.statusPill(r)}
                      </button>`;
                    })
                  : list.map((x) => html`<span class="ar-sources-item">${label(x)}</span>`)
              }
            </div>
          </details>`
        : html`<p class="ar-sources-clear">Nothing to fix.</p>`;
      return AR.Card({
        top: [
          html`<span class="ar-sources-check">${h.title}</span>`,
          AR.Pill({ text: String(count), tone: count ? 'warn' : 'ok' }),
        ],
        body: html`<p class="ar-sources-hint">${AR.md(h.hint)}</p>
          ${body}`,
      });
    });
    return AR.Stack({
      gap: '6',
      children: html`<p class="ar-sources-hint">
          Where the registry is weak, from the registry and the ADR files. The status filters and
          the search narrow the rule lists.
        </p>
        ${AR.Stack({ gap: '5', children: items })}`,
    });
  }

  Rules.view({
    id: 'sources',
    label: 'Sources',
    order: 60,
    controls(ctx) {
      return AR.Tabs({
        items: [
          { id: 'sources', label: 'Sources' },
          { id: 'code', label: 'Code' },
          { id: 'health', label: 'Health' },
        ],
        selected: modeOf(ctx),
        role: 'radio',
        key: 'src',
        label: 'Sources view',
      });
    },
    onClick(e, ctx) {
      const m = e.target.closest('[data-src]');
      if (m) {
        mode = m.dataset.src;
        pick = null;
        ctx.save('ar-sources', mode);
        ctx.render();
        return true;
      }
      const flow = e.target.closest('[data-flow]');
      if (flow) {
        const i = Number(flow.dataset.flow);
        pick = pick?.kind === 'flow' && pick.i === i ? null : { kind: 'flow', i };
        ctx.render();
        return true;
      }
      const node = e.target.closest('[data-node]');
      if (node) {
        const p = { kind: 'node', side: node.dataset.node, key: node.dataset.key };
        pick = pick?.kind === 'node' && pick.side === p.side && pick.key === p.key ? null : p;
        ctx.render();
        return true;
      }
      const path = e.target.closest('[data-path], [data-pick-path]');
      if (path) {
        const p = path.dataset.path ?? path.dataset.pickPath;
        pick = pick?.kind === 'path' && pick.path === p ? null : { kind: 'path', path: p };
        ctx.render();
        return true;
      }
      return false;
    },
    mount(ctx) {
      const el = document.getElementById('view');
      const w = el ? Math.floor(el.clientWidth) : width;
      if (!listening) {
        listening = true;
        let t = 0;
        addEventListener('resize', () => {
          clearTimeout(t);
          t = setTimeout(() => {
            const v = document.getElementById('view');
            if (
              location.hash.replace('#', '') === 'sources' &&
              v &&
              Math.abs(v.clientWidth - width) > 4
            )
              ctx.render();
          }, 150);
        });
      }
      if (w > 0 && Math.abs(w - width) > 4) {
        width = w;
        ctx.render();
      }
    },
    render(ctx) {
      const el = document.getElementById('view');
      if (el && el.clientWidth > 0) width = Math.floor(el.clientWidth);
      const m = modeOf(ctx);
      return m === 'code' ? codeView(ctx) : m === 'health' ? healthView(ctx) : sourcesView(ctx);
    },
  });
})();
