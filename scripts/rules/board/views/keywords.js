// The Keywords tab (ADR 0026, amended 2026-11-28): the keyword map, which joins
// keywords that tag the same rules, and the glossary, each keyword with its
// definition and its rules by concept. It also adds each rule's keywords,
// symbols and "Rules sharing a keyword" to the drawer, on every tab.
(() => {
  const { html } = AR;
  const KEY = 'ar-keywords';
  const MODES = [
    { id: 'map', label: 'Map' },
    { id: 'glossary', label: 'Glossary' },
  ];
  const SORTS = [
    { id: 'concepts', label: 'Most concepts' },
    { id: 'rules', label: 'Most rules' },
    { id: 'name', label: 'A–Z' },
  ];
  const local = { mode: 'map', sort: 'concepts', selected: null, ready: false };

  function restore(ctx) {
    if (local.ready) return;
    local.ready = true;
    const saved = ctx.load(KEY);
    if (!saved) return;
    try {
      const v = JSON.parse(saved);
      if (MODES.some((m) => m.id === v.mode)) local.mode = v.mode;
      if (SORTS.some((s) => s.id === v.sort)) local.sort = v.sort;
      if (typeof v.selected === 'string') local.selected = v.selected;
    } catch (e) {}
  }
  const remember = (ctx) =>
    ctx.save(KEY, JSON.stringify({ mode: local.mode, sort: local.sort, selected: local.selected }));

  /** A keyword's rules that pass the status filters and the search. */
  const rulesOf = (ctx, k) =>
    (ctx.model.keywordRules[k] || [])
      .map((id) => ctx.byId[id])
      .filter((r) => r && ctx.matches(r, { ignoreKeywords: true }));

  /** Rules per concept, in the concepts' order, for the given rules. */
  const perConcept = (ctx, rules) =>
    ctx.concepts
      .map((c) => ({ c, rules: rules.filter((r) => r.concept === c.id) }))
      .filter((x) => x.rules.length);

  /** Concept colours: the 8 concepts with the most tagged rules get a slot each. */
  function conceptSlots(ctx) {
    const counts = new Map();
    for (const ids of Object.values(ctx.model.keywordRules))
      for (const id of ids) {
        const r = ctx.byId[id];
        if (r) counts.set(r.concept, (counts.get(r.concept) || 0) + 1);
      }
    return AR.chart.slots(
      ctx.concepts
        .filter((c) => counts.has(c.id))
        .map((c) => ({ key: c.id, label: c.name, count: counts.get(c.id) })),
    );
  }

  const dominant = (ctx, k) => {
    const by = perConcept(ctx, rulesOf(ctx, k));
    by.sort((a, b) => b.rules.length - a.rules.length);
    return by.length ? by[0].c.id : null;
  };

  function neighbours(ctx) {
    const out = new Map();
    for (const e of ctx.model.keywordGraph.edges) {
      if (!out.has(e.a)) out.set(e.a, []);
      if (!out.has(e.b)) out.set(e.b, []);
      out.get(e.a).push({ id: e.b, edge: e });
      out.get(e.b).push({ id: e.a, edge: e });
    }
    for (const list of out.values()) list.sort((p, q) => q.edge.weight - p.edge.weight);
    return out;
  }

  const strength = (w) => (w >= 0.5 ? 3 : w >= 0.25 ? 2 : 1);

  function shareBar(ctx, slots, rules, label) {
    return AR.ShareBar({
      label,
      parts: perConcept(ctx, rules).map((x) => ({
        key: x.c.id,
        label: x.c.name,
        value: x.rules.length,
        slot: slots.slotOf(x.c.id),
      })),
    });
  }

  function rulesByConcept(ctx, rules) {
    return AR.Stack({
      gap: '4',
      children: perConcept(ctx, rules).map(
        (x) =>
          html`<section class="ar-stack ar-keywords-group">
            <h4 class="ar-keywords-group-name">${x.c.name} · ${x.rules.length}</h4>
            ${x.rules.map(
              (r) =>
                html`<button class="ar-keywords-rule" data-id="${r.id}">
                  <span class="ar-keywords-rule-id">${r.id}</span>
                  <span class="ar-keywords-rule-text">${AR.md(r.statement)}</span>
                </button>`,
            )}
          </section>`,
      ),
    });
  }

  function panel(ctx, slots, ties) {
    const k = ctx.keywords.find((x) => x.id === local.selected);
    if (!k)
      return AR.EmptyState({
        text: 'Pick a keyword on the map to see its definition, its strongest ties and its rules.',
      });
    const rules = rulesOf(ctx, k.id);
    const near = (ties.get(k.id) || []).slice(0, 6);
    return html`<div class="ar-keywords-panel">
      ${AR.Stack({
        gap: '6',
        children: html`${AR.Stack({
          gap: '2',
          children: html`<h3 class="ar-keywords-title">${k.label}</h3>
            <p class="ar-keywords-def">${k.definition}</p>
            ${
              k.aliases.length
                ? html`<p class="ar-keywords-aliases">
                    Also:
                    ${AR.join(
                      k.aliases.map((a) => html`<code>${a}</code>`),
                      ', ',
                    )}
                  </p>`
                : ''
            }`,
        })}
        ${shareBar(ctx, slots, rules, `Rules per concept for ${k.label}`)}
        ${AR.Cluster({
          gap: '3',
          children: html`<button class="ar-keywords-action" data-kw-board="${k.id}">
            Show its ${rules.length} rule${rules.length === 1 ? '' : 's'} on the Board
          </button>`,
        })}
        ${
          near.length
            ? html`<section class="ar-stack">
                <h4 class="ar-keywords-group-name">Strongest ties</h4>
                ${AR.Cluster({
                  gap: '3',
                  children: near.map((n) =>
                    AR.Chip({
                      label: ctx.kwLabel[n.id] || n.id,
                      count: n.edge.shared,
                      attrs: { 'data-kwsel': n.id, title: `${n.edge.shared} shared rules` },
                    }),
                  ),
                })}
              </section>`
            : ''
        }
        ${rules.length ? rulesByConcept(ctx, rules) : AR.EmptyState({ text: 'No rule matches the filters.' })}`,
      })}
    </div>`;
  }

  function map(ctx) {
    const g = ctx.model.keywordGraph;
    if (!g.nodes.length)
      return AR.EmptyState({
        size: 'l',
        text: `No rule has keywords yet. Add a "keywords" list to rules in ${ctx.config.rulesDir}, using ids from keywords.json, then run pnpm rules:board again.`,
      });
    const slots = conceptSlots(ctx);
    const ties = neighbours(ctx);
    const at = new Map(g.nodes.map((n) => [n.id, n]));
    const sel = local.selected;
    const near = new Set(sel ? [sel, ...(ties.get(sel) || []).map((t) => t.id)] : []);
    const edges = g.edges.map((e) => {
      const a = at.get(e.a);
      const b = at.get(e.b);
      return AR.chart.line({
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        cls: 'ar-keywords-edge',
        attrs: {
          'data-a': e.a,
          'data-b': e.b,
          'data-strength': strength(e.weight),
          'data-on': sel && (e.a === sel || e.b === sel),
        },
      });
    });
    const nodes = g.nodes.map((n) => {
      const count = rulesOf(ctx, n.id).length;
      const label = ctx.kwLabel[n.id] || n.id;
      return html`<g
        class="ar-keywords-node"
        ${AR.attrs({
          'data-kwsel': n.id,
          'data-faded': count === 0 || (sel && !near.has(n.id)),
          'data-on': n.id === sel,
          tabindex: '0',
          role: 'button',
          'aria-label': `${label}, ${count} rules`,
        })}
      >
        ${AR.chart.circle({ cx: n.x, cy: n.y, r: n.r, slot: slots.slotOf(dominant(ctx, n.id)) })}
        ${AR.chart.text({ x: n.x, y: n.y + n.r + 13, value: label, anchor: 'middle', cls: 'ar-keywords-label' })}
      </g>`;
    });
    const chart = AR.ChartFrame({
      title: 'Keyword map',
      sub: 'Keywords that tag the same rules sit close together, joined by a line; bigger circles tag more rules.',
      legend: AR.chart.legendFor(slots.groups, 'Colour: the concept a keyword tags most'),
      body: html`<div class="ar-keywords-scroll">
        ${AR.chart.svg({
          width: g.width,
          height: g.height,
          label: 'Keyword map',
          body: html`<g class="ar-keywords-edges">${edges}</g><g>${nodes}</g>`,
          attrs: { class: 'ar-keywords-map', 'data-focus': Boolean(sel) },
        })}
      </div>`,
      note: `${g.nodes.length} keywords in use, ${g.edges.length} ties drawn: each keyword keeps its 4 strongest.`,
    });
    return AR.Split({
      gap: '7',
      side: 'col-min',
      end: true,
      children: html`<div class="ar-keywords-main">${chart}</div>
        ${panel(ctx, slots, ties)}`,
    });
  }

  function glossary(ctx) {
    const slots = conceptSlots(ctx);
    const rows = ctx.keywords.map((k) => {
      const rules = rulesOf(ctx, k.id);
      return { k, rules, concepts: perConcept(ctx, rules).length };
    });
    const by = {
      concepts: (a, b) =>
        b.concepts - a.concepts ||
        b.rules.length - a.rules.length ||
        a.k.label.localeCompare(b.k.label),
      rules: (a, b) => b.rules.length - a.rules.length || a.k.label.localeCompare(b.k.label),
      name: (a, b) => a.k.label.localeCompare(b.k.label),
    }[local.sort];
    rows.sort(by);
    return AR.Grid({
      gap: '6',
      min: 'col-min',
      children: rows.map(({ k, rules, concepts }) =>
        AR.Card({
          dim: rules.length === 0,
          top: [
            html`<button class="ar-keywords-name" data-kwsel="${k.id}" data-kwmap="">
              ${k.label}
            </button>`,
            html`<span class="ar-keywords-count"
              >${rules.length} rule${rules.length === 1 ? '' : 's'} · ${concepts}
              concept${concepts === 1 ? '' : 's'}</span
            >`,
          ],
          body: html`<p class="ar-keywords-def">${k.definition}</p>
            ${rules.length ? shareBar(ctx, slots, rules, `Rules per concept for ${k.label}`) : ''}
            ${
              rules.length
                ? html`<details class="ar-keywords-more">
                    <summary>Its rules</summary>
                    ${rulesByConcept(ctx, rules)}
                  </details>`
                : ''
            }`,
          foot: [
            k.aliases.length
              ? html`Also:
                ${AR.join(
                  k.aliases.slice(0, 4).map((a) => html`<code>${a}</code>`),
                  ', ',
                )}`
              : '',
            rules.length
              ? html`<button class="ar-keywords-action" data-kw-board="${k.id}">
                  On the Board
                </button>`
              : '',
          ],
        }),
      ),
    });
  }

  function tooltipFor(ctx, id, ties) {
    const k = ctx.keywords.find((x) => x.id === id);
    if (!k) return '';
    const near = (ties.get(id) || []).slice(0, 4);
    return html`<b>${k.label}</b> · ${rulesOf(ctx, id).length} rules<br />${k.definition}${
        near.length
          ? html`<br />Ties:
              ${AR.join(
                near.map((n) => ctx.kwLabel[n.id] || n.id),
                ', ',
              )}`
          : ''
      }`;
  }

  Rules.view({
    id: 'keywords',
    label: 'Keywords',
    order: 40,
    controls(ctx) {
      restore(ctx);
      return html`${AR.Tabs({
        items: MODES,
        selected: local.mode,
        role: 'radio',
        key: 'kwmode',
        label: 'Keyword views',
      })}${
        local.mode === 'glossary'
          ? AR.Tabs({
              items: SORTS,
              selected: local.sort,
              role: 'radio',
              key: 'kwsort',
              label: 'Sort keywords',
            })
          : ''
      }`;
    },
    render(ctx) {
      restore(ctx);
      if (!ctx.keywords.length)
        return AR.EmptyState({
          size: 'l',
          text: `No keyword vocabulary. Add keywords.json to ${ctx.config.rulesDir} to use this tab.`,
        });
      return local.mode === 'glossary' ? glossary(ctx) : map(ctx);
    },
    mount(ctx) {
      const svg = document.querySelector('.ar-keywords-map');
      if (!svg) return;
      const ties = neighbours(ctx);
      const focus = (id) => {
        const near = new Set([id, ...(ties.get(id) || []).map((t) => t.id)]);
        svg.setAttribute('data-hover', '');
        svg.querySelectorAll('.ar-keywords-node').forEach((n) => {
          n.toggleAttribute('data-near', near.has(n.dataset.kwsel));
        });
        svg.querySelectorAll('.ar-keywords-edge').forEach((e) => {
          e.toggleAttribute('data-near', e.dataset.a === id || e.dataset.b === id);
        });
      };
      const clear = () => {
        svg.removeAttribute('data-hover');
        svg.querySelectorAll('[data-near]').forEach((n) => n.removeAttribute('data-near'));
        AR.tooltip.hide();
      };
      svg.addEventListener('mouseover', (e) => {
        const n = e.target.closest('.ar-keywords-node');
        if (!n) return;
        focus(n.dataset.kwsel);
        AR.tooltip.show(tooltipFor(ctx, n.dataset.kwsel, ties), e.clientX, e.clientY);
      });
      svg.addEventListener('mousemove', (e) => {
        const n = e.target.closest('.ar-keywords-node');
        if (n) AR.tooltip.show(tooltipFor(ctx, n.dataset.kwsel, ties), e.clientX, e.clientY);
      });
      svg.addEventListener('mouseout', (e) => {
        if (
          !e.relatedTarget ||
          !e.relatedTarget.closest ||
          !e.relatedTarget.closest('.ar-keywords-node')
        )
          clear();
      });
      svg.addEventListener('keydown', (e) => {
        const n = e.target.closest('.ar-keywords-node');
        if (n && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          n.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      });
    },
    onClick(e, ctx) {
      const mode = e.target.closest('[data-kwmode]');
      if (mode) {
        local.mode = mode.dataset.kwmode;
        remember(ctx);
        ctx.render();
        return true;
      }
      const sort = e.target.closest('[data-kwsort]');
      if (sort) {
        local.sort = sort.dataset.kwsort;
        remember(ctx);
        ctx.render();
        return true;
      }
      const sel = e.target.closest('[data-kwsel]');
      if (sel) {
        const id = sel.dataset.kwsel;
        local.selected = local.selected === id && !sel.hasAttribute('data-kwmap') ? null : id;
        if (sel.hasAttribute('data-kwmap')) local.mode = 'map';
        AR.tooltip.hide();
        remember(ctx);
        ctx.render();
        return true;
      }
      const board = e.target.closest('[data-kw-board]');
      if (board) {
        ctx.filterKeyword(board.dataset.kwBoard);
        return true;
      }
      return false;
    },
    drawer(r, ctx) {
      const facts = [];
      if (r.keywords && r.keywords.length)
        facts.push([
          'Keywords',
          AR.Cluster({
            gap: '3',
            children: r.keywords.map(
              (k) =>
                html`<button class="ar-keywords-tag" data-kw="${k}" title="Filter by this keyword">
                  ${ctx.kwLabel[k] || k}
                </button>`,
            ),
          }),
        ]);
      const syms = ctx.model.symbols[r.id] || [];
      if (syms.length)
        facts.push([
          'Symbols',
          AR.Cluster({
            gap: '3',
            children: syms.map(
              (x) =>
                html`<button class="ar-keywords-sym" data-sym="${x}" title="Filter by this symbol">
                  <code>${x}</code>
                </button>`,
            ),
          }),
        ]);
      const near = ctx.model.keywordNeighbours[r.id] || [];
      const sections = near.length
        ? [
            {
              heading: 'Rules sharing a keyword, from other concepts',
              body: AR.Stack({
                gap: '3',
                children: near.map((n) => {
                  const o = ctx.byId[n.id];
                  return html`<button class="ar-keywords-rule" data-id="${n.id}">
                    <span class="ar-keywords-rule-id"
                      >${n.id} · ${ctx.cName[o ? o.concept : ''] || ''}</span
                    >
                    <span class="ar-keywords-rule-text">${o ? AR.md(o.statement) : ''}</span>
                    <span class="ar-keywords-rule-why"
                      >Shares:
                      ${AR.join(
                        n.keywords.map((k) => ctx.kwLabel[k] || k),
                        ', ',
                      )}</span
                    >
                  </button>`;
                }),
              }),
            },
          ]
        : [];
      return { facts, sections };
    },
  });
})();
