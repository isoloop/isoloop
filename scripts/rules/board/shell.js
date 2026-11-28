// The rules page's shell (ADR 0026, amended 2026-11-28): the data, the shared
// status filters and search, the tabs (routed by the URL's hash), the theme
// switch and the rule drawer, all built from the design system's components.
// Each view registers itself with `Rules.view({...})` from views/, and
// `Rules.start()` runs last. Views get everything through `ctx`.
// Shared filters: the statuses, the search, the keywords (a rule must carry
// every chosen one) and one symbol. Any element with `data-kw="<id>"` toggles a
// keyword filter and `data-sym="<name>"` picks a symbol, from any view or the drawer.
const Rules = (() => {
  const { html, raw, md, attrs } = AR;
  const DATA = /*RULES_DATA*/ null || {
    config: { title: 'Rules', rulesDir: 'docs/rules' },
    concepts: [],
    rules: [],
    refs: {},
    keywords: [],
    model: {
      symbols: {},
      links: [],
      tooCommon: [],
      keywordRules: {},
      keywordGraph: { width: 1000, height: 600, nodes: [], edges: [] },
      keywordNeighbours: {},
      history: {},
      points: [],
    },
  };
  const CONCEPTS = DATA.concepts;
  const RULES = DATA.rules;
  const REFS = DATA.refs;
  const STATUS = {
    active: 'Active',
    decided: 'Decided',
    proposed: 'Proposed',
    withdrawn: 'Withdrawn',
    rejected: 'Rejected',
    superseded: 'Superseded',
  };
  /** The tone each status and each event type is shown in. */
  const STATUS_TONE = {
    active: 'ok',
    decided: 'info',
    proposed: 'warn',
    withdrawn: 'off',
    rejected: 'off',
    superseded: 'gone',
  };
  const EVENT_TONE = {
    decided: 'ok',
    shipped: 'ok',
    built: 'ok',
    amended: 'info',
    clarified: 'info',
    proposed: 'warn',
    reopened: 'warn',
    corrected: 'gone',
    removed: 'gone',
    rejected: 'gone',
    withdrawn: 'gone',
    superseded: 'gone',
  };
  const DIM = ['withdrawn', 'rejected', 'superseded'];
  const byId = Object.fromEntries(
    RULES.flatMap((r) => [[r.id, r], ...(r.aliases || []).map((a) => [a, r])]),
  );
  const cName = Object.fromEntries(CONCEPTS.map((c) => [c.id, c.name]));
  const fmtDate = (d) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const refLabel = (ref) => (REFS[ref] ? REFS[ref].label : ref);
  const refHtml = (ref) => {
    const r = REFS[ref];
    return r && r.url
      ? html`<a class="ar-shell-ref" href="${r.url}" target="_blank" rel="noopener">${r.label}</a>`
      : html`<span class="ar-shell-ref">${refLabel(ref)}</span>`;
  };
  const inForce = (r) => (r.repo ? r.events.find((e) => e.type === 'built') : undefined);
  const currentWhy = (r) => {
    for (let i = r.events.length - 1; i >= 0; i--) {
      const t = r.events[i].type;
      if (t === 'decided' || t === 'amended' || t === 'clarified') return r.events[i];
    }
    return undefined;
  };
  const statusPill = (r) => AR.Pill({ text: STATUS[r.status], tone: STATUS_TONE[r.status] });
  const eventLabel = (type) =>
    html`<span class="ar-shell-event" ${attrs({ 'data-tone': EVENT_TONE[type] })}>${type}</span>`;
  const load = (k) => {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  };
  const save = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  };

  // Shared state: the status filters, the search, the keywords and the symbol apply to every
  // view, and "as of" to every view that opts in with `asOf: true`.
  const KEYWORDS = DATA.keywords || [];
  const kwLabel = Object.fromEntries(KEYWORDS.map((k) => [k.id, k.label]));
  const SYMBOLS = [...new Set(Object.values(DATA.model.symbols || {}).flat())].sort((a, b) =>
    a.localeCompare(b),
  );
  const state = {
    query: '',
    on: new Set(['active', 'decided', 'proposed']),
    keywords: new Set(),
    symbol: '',
    asOf: { point: 'today', compare: false, from: null, to: 'today' },
  };
  // --- As of (ADR 0026, amended 2026-11-28) ------------------------------------
  // Each rule's snapshots come from the build (model.history), so a point in
  // time is a lookup. Limits accepted for now: a whole day is one step, earlier
  // wording comes from `prev`, and only the statement and the status have a
  // history (`since` follows the shipped event that set the status); every
  // other field shows today's value.
  const POINTS = DATA.model.points || [];
  const HISTORY = DATA.model.history || {};
  const TODAY = POINTS.length ? POINTS[POINTS.length - 1] : { id: 'today', date: '9999-12-31' };
  const pointById = Object.fromEntries(POINTS.map((p) => [p.id, p]));
  const pointOf = (id) => pointById[id] || TODAY;
  const pointLabel = (p) =>
    p.id === 'today'
      ? `Today · ${fmtDate(p.date)}`
      : p.tag
        ? `${p.tag} · ${fmtDate(p.date)}`
        : fmtDate(p.date);
  const snapshotAt = (id, date) => {
    let found;
    for (const s of HISTORY[id] || []) {
      if (s.date > date) break;
      found = s;
    }
    return found;
  };
  /** The rule `r` as it stood at the end of `point`'s day, or undefined if it didn't exist yet. */
  function ruleAt(r, point) {
    if (point.id === 'today') return r;
    const s = snapshotAt(r.id, point.date);
    if (!s) return undefined;
    const out = Object.assign({}, r, {
      status: s.status,
      statement: s.statement,
      events: r.events.filter((e) => e.date <= point.date),
      changedSince: r.events.some((e) => e.date > point.date),
    });
    if (s.since) out.since = s.since;
    else {
      delete out.since;
      // Not shipped yet then: the version it later shipped in was its target.
      if (!r.target && r.since && (s.status === 'decided' || s.status === 'proposed'))
        out.target = r.since;
    }
    return out;
  }
  const atCache = new Map();
  function rulesAt(pointId) {
    if (!atCache.has(pointId)) {
      const p = pointOf(pointId);
      atCache.set(pointId, RULES.map((r) => ruleAt(r, p)).filter(Boolean));
    }
    return atCache.get(pointId);
  }
  const asOfOn = () => !!(current && current.asOf) && state.asOf.point !== 'today';
  const visibleRules = () => (asOfOn() ? rulesAt(state.asOf.point) : RULES);
  /**
   * What changed between two points: { from, to, items, counts }. Each item is
   * { rule (today's), before, after (each the rule at that point, or undefined),
   * kinds: ['added' | 'status' | 'wording' | 'removed'], events (between them) }.
   */
  function diff(fromId, toId) {
    let from = pointOf(fromId);
    let to = pointOf(toId);
    if (from.date > to.date) [from, to] = [to, from];
    const items = [];
    const counts = { added: 0, status: 0, wording: 0, removed: 0 };
    for (const r of RULES) {
      const before = ruleAt(r, from);
      const after = ruleAt(r, to);
      const kinds = [];
      if (!before && after) kinds.push('added');
      else if (before && !after) kinds.push('removed');
      else if (before && after) {
        if (before.status !== after.status) kinds.push('status');
        if (before.statement !== after.statement) kinds.push('wording');
      }
      if (!kinds.length) continue;
      kinds.forEach((k) => counts[k]++);
      items.push({
        rule: r,
        before,
        after,
        kinds,
        events: r.events.filter((e) => e.date > from.date && e.date <= to.date),
      });
    }
    return { from, to, items, counts };
  }
  /** Whether a rule passes the shared filters; `ignoreKeywords` skips the keyword and symbol filters. */
  function matches(r, opts = {}) {
    if (!state.on.has(r.status)) return false;
    if (!opts.ignoreKeywords) {
      for (const k of state.keywords) if (!(r.keywords || []).includes(k)) return false;
      if (state.symbol && !((DATA.model.symbols || {})[r.id] || []).includes(state.symbol))
        return false;
    }
    if (!state.query) return true;
    const hay = [
      r.id,
      r.statement,
      r.knob,
      ...(r.code || []),
      ...(r.errors || []),
      ...(r.values || []),
      ...(r.aliases || []),
      ...((DATA.model.symbols || {})[r.id] || []),
      ...r.events.map((e) => e.ref + ' ' + refLabel(e.ref) + ' ' + e.why),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(state.query);
  }

  // Views, sorted by `order`. A view is { id, label, order, render(ctx) → SafeHtml,
  // controls?(ctx) → SafeHtml for the header, onClick?(event, ctx) → true when
  // handled, mount?(ctx) after its HTML is in the page, drawer?(rule, ctx) →
  // { facts?: [[term, value]], sections?: [{ heading, body }] } added to every
  // rule's drawer, whichever tab is open }.
  const views = [];
  let current = null;
  function view(def) {
    if (!def || !def.id || !def.label || typeof def.render !== 'function')
      throw new Error('Rules.view needs an id, a label and render()');
    if (views.some((v) => v.id === def.id))
      throw new Error(`Rules.view: "${def.id}" is used twice`);
    views.push(def);
    views.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /**
   * What views read. `rules` follows "as of": in a view registered with
   * `asOf: true`, while a point other than today is chosen, it holds each rule
   * as it stood then (status, statement, `since`, the events up to that day,
   * and `changedSince`), and leaves out rules that didn't exist yet.
   * `allRules` is always today's registry. `asOf` is the API:
   *   asOf.on            true while a past point is shown in this view
   *   asOf.point         the point shown: { id, date, tag? }
   *   asOf.points        every point, oldest first; the last is today
   *   asOf.label(point)  "v0.1.0 · 23 Nov", "Today · 28 Nov" or "5 Nov"
   *   asOf.ruleAt(id, pointId?)  a rule at a point (the shown one by default)
   *   asOf.changedSince(id)      true if the rule has events after the point
   *   asOf.diff(fromId, toId)    { from, to, items, counts }, see diff()
   *   asOf.set(pointId)          show another point and re-render
   */
  const ctx = {
    data: DATA,
    config: DATA.config,
    concepts: CONCEPTS,
    get rules() {
      return visibleRules();
    },
    allRules: RULES,
    refs: REFS,
    keywords: KEYWORDS,
    kwLabel,
    symbols: SYMBOLS,
    model: DATA.model,
    STATUS,
    STATUS_TONE,
    EVENT_TONE,
    DIM,
    byId,
    cName,
    fmtDate,
    refLabel,
    refHtml,
    inForce,
    currentWhy,
    statusPill,
    eventLabel,
    load,
    save,
    state,
    matches,
    render: () => render(),
    openRule: (id) => openRule(id),
    asOf: {
      get on() {
        return asOfOn();
      },
      get point() {
        return asOfOn() ? pointOf(state.asOf.point) : TODAY;
      },
      points: POINTS,
      label: pointLabel,
      ruleAt: (id, pointId) => {
        const r = byId[id];
        return r && ruleAt(r, pointOf(pointId || (asOfOn() ? state.asOf.point : 'today')));
      },
      changedSince: (id) => {
        const r = byId[id];
        return !!r && asOfOn() && r.events.some((e) => e.date > pointOf(state.asOf.point).date);
      },
      diff,
      set: (pointId) => setPoint(pointId),
    },
    show: (id) => show(id, true),
    /** Filters every view to one keyword and shows the Board. */
    filterKeyword: (id) => {
      state.keywords = new Set([id]);
      closeRule();
      show('board', true);
    },
  };

  const $ = (id) => document.getElementById(id);
  function frame() {
    $('ar-app').innerHTML = String(
      html`<div class="ar-shell ar-stack" style="--ar-gap: var(--ar-space-7)">
        <header
          class="ar-cluster ar-shell-head"
          style="--ar-gap: var(--ar-space-5) var(--ar-space-8)"
        >
          ${AR.Stack({
            gap: '1',
            children: html`<h1 class="ar-shell-title" id="title">${DATA.config.title}</h1>
              <p class="ar-shell-sub">
                What holds today, one fact per card. Open a card for its values, where it lives in
                the code, and every decision that touched it.
              </p>`,
          })}
          ${AR.Toolbar({
            label: 'Page',
            children: html`<div id="tabs"></div>
              <div class="ar-toolbar" id="view-controls"></div>
              ${AR.Tabs({
                items: [
                  { id: 'system', label: 'System' },
                  { id: 'light', label: 'Light' },
                  { id: 'dark', label: 'Dark' },
                ],
                selected: 'system',
                role: 'radio',
                key: 't',
                label: 'Theme',
              })}`,
          })}
        </header>
        ${AR.Toolbar({
          label: 'Filters',
          children: html`${AR.Field({ id: 'q', type: 'search', label: 'Search', hideLabel: true, placeholder: 'Search rules, values, knobs, refs…' })}
            <div class="ar-cluster" id="filters"></div>
            ${
              SYMBOLS.length
                ? html`${AR.Field({ id: 'sym', type: 'search', label: 'Symbol', hideLabel: true, placeholder: 'Pick a symbol…', list: 'sym-list' })}
                    <datalist id="sym-list">
                      ${SYMBOLS.map((x) => html`<option value="${x}"></option>`)}
                    </datalist>`
                : ''
            }`,
        })}
        ${
          KEYWORDS.some((k) => (DATA.model.keywordRules[k.id] || []).length)
            ? html`<details class="ar-shell-kw" id="kw-filter">
                <summary class="ar-shell-kw-summary">Keywords</summary>
                <div class="ar-cluster" id="kw-chips"></div>
              </details>`
            : ''
        }
        <div class="ar-cluster" id="active-filters" hidden></div>
        <section class="ar-stack ar-shell-asof" id="as-of" aria-label="As of" hidden></section>
        <main id="view"></main>
        <p class="ar-shell-note" id="note"></p>
      </div>`,
    );
    $('ar-app').querySelector('[role="radiogroup"][aria-label="Theme"]').id = 'theme';
  }

  function renderFilters() {
    const counts = {};
    visibleRules().forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
    $('filters').innerHTML = String(
      html`${Object.keys(STATUS).map((s) =>
        AR.Chip({
          label: STATUS[s],
          pressed: state.on.has(s),
          count: counts[s] || 0,
          tone: STATUS_TONE[s],
          attrs: { 'data-s': s },
        }),
      )}`,
    );
  }
  function renderKeywordFilters() {
    const chips = $('kw-chips');
    if (chips)
      chips.innerHTML = String(
        html`${KEYWORDS.filter((k) => (DATA.model.keywordRules[k.id] || []).length).map((k) =>
          AR.Chip({
            label: k.label,
            pressed: state.keywords.has(k.id),
            count: DATA.model.keywordRules[k.id].length,
            attrs: { 'data-kw': k.id, title: k.definition },
          }),
        )}`,
      );
    const active = $('active-filters');
    const parts = [
      ...[...state.keywords].map((k) =>
        AR.Chip({
          label: html`Keyword: ${kwLabel[k] || k} ×`,
          pressed: true,
          attrs: { 'data-kw': k },
        }),
      ),
      ...(state.symbol
        ? [
            AR.Chip({
              label: html`Symbol: <code>${state.symbol}</code> ×`,
              pressed: true,
              attrs: { 'data-sym-clear': '' },
            }),
          ]
        : []),
    ];
    active.innerHTML = String(html`${parts}`);
    active.hidden = parts.length === 0;
  }
  function render() {
    if (!current) return;
    $('tabs').innerHTML = String(
      AR.Tabs({
        items: views.map((v) => ({ id: v.id, label: v.label })),
        selected: current.id,
        label: 'Views',
        idPrefix: 'tab-',
      }),
    );
    const controls = $('view-controls');
    const c = current.controls ? String(current.controls(ctx)) : '';
    controls.innerHTML = c;
    controls.hidden = !c;
    renderFilters();
    renderKeywordFilters();
    renderAsOf();
    $('view').innerHTML = String(current.render(ctx));
    if (current.mount) current.mount(ctx);
  }
  const KIND_LABEL = {
    added: 'Added',
    status: 'Status changed',
    wording: 'Wording changed',
    removed: 'Removed',
  };
  const KIND_TONE = { added: 'ok', status: 'info', wording: 'warn', removed: 'gone' };
  function renderChanges() {
    const pointItems = POINTS.map((p) => ({ id: p.id, label: pointLabel(p) }));
    const from =
      state.asOf.from || (state.asOf.point !== 'today' ? state.asOf.point : POINTS[0]?.id);
    const d = diff(from, state.asOf.to);
    const shown = d.items.filter((it) => matches(it.after || it.before));
    const groups = CONCEPTS.map((c) => ({
      c,
      items: shown.filter((it) => it.rule.concept === c.id),
    })).filter((g) => g.items.length);
    const item = (it) => {
      const a = it.before;
      const b = it.after || it.before;
      return html`<li class="ar-stack ar-shell-change" style="--ar-gap: var(--ar-space-3)">
        ${AR.Cluster({
          gap: '3',
          children: html`<button class="ar-shell-change-id" data-id="${it.rule.id}">
              ${it.rule.id}
            </button>
            ${it.kinds.map((k) => AR.Pill({ text: KIND_LABEL[k], tone: KIND_TONE[k] }))}
            ${
              it.kinds.includes('status')
                ? html`${statusPill(a)}<span class="ar-shell-change-arrow">→</span>${statusPill(b)}`
                : statusPill(b)
            }`,
        })}
        ${
          it.kinds.includes('wording')
            ? AR.BeforeAfter({ before: md(a.statement), after: md(b.statement) })
            : html`<p class="ar-shell-change-text">${md(b.statement)}</p>`
        }
        ${
          it.events.length
            ? html`<p class="ar-shell-change-events">
                ${AR.join(
                  it.events.map((e) => html`${eventLabel(e.type)} ${fmtDate(e.date)}`),
                  ' · ',
                )}
              </p>`
            : ''
        }
      </li>`;
    };
    return html`<div class="ar-stack ar-shell-changes" style="--ar-gap: var(--ar-space-6)">
      ${AR.Toolbar({
        label: 'Compare',
        children: html`${AR.Select({ id: 'as-of-from', label: 'From', options: pointItems, selected: d.from.id })}
        ${AR.Select({ id: 'as-of-to', label: 'To', options: pointItems, selected: d.to.id })}`,
      })}
      ${AR.Cluster({
        gap: '3',
        children: Object.keys(KIND_LABEL)
          .filter((k) => d.counts[k])
          .map((k) => AR.Pill({ text: `${KIND_LABEL[k]} ${d.counts[k]}`, tone: KIND_TONE[k] })),
      })}
      ${
        groups.length
          ? groups.map(
              (g) =>
                html`<section class="ar-stack" style="--ar-gap: var(--ar-space-4)">
                  <h2 class="ar-shell-change-concept">${g.c.name} · ${g.items.length}</h2>
                  <ul class="ar-stack ar-shell-change-list" style="--ar-gap: var(--ar-space-5)">
                    ${g.items.map(item)}
                  </ul>
                </section>`,
            )
          : AR.EmptyState({
              text: `Nothing changed between ${pointLabel(d.from)} and ${pointLabel(d.to)}.`,
            })
      }
    </div>`;
  }
  function renderAsOf() {
    const box = $('as-of');
    if (!current || !current.asOf || !POINTS.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    const p = pointOf(state.asOf.point);
    const on = asOfOn();
    const existed = on ? rulesAt(p.id) : RULES;
    const changed = on ? existed.filter((r) => r.changedSince).length : 0;
    const summary = on
      ? `${existed.length} rules existed on ${pointLabel(p)}. ${changed} changed since · ${RULES.length - existed.length} added later.`
      : `Showing today: ${RULES.length} rules. Step back to see the registry as it stood on an earlier day or release.`;
    box.innerHTML = String(
      html`${AR.Toolbar({
          label: 'As of',
          children: html`<span class="ar-shell-asof-label">As of</span> ${AR.Stepper({
              id: 'as-of-point',
              label: 'As of',
              items: POINTS.map((x) => ({ id: x.id, label: pointLabel(x) })),
              selected: p.id,
            })}
            ${on ? AR.Chip({ label: 'Back to today', attrs: { 'data-asof': 'today' } }) : ''}
            ${AR.Chip({ label: 'Compare', pressed: state.asOf.compare, attrs: { 'data-compare': '' } })}`,
        })}
        <p class="ar-shell-asof-summary">${summary}</p>
        ${state.asOf.compare ? renderChanges() : ''}`,
    );
  }
  function setPoint(id) {
    state.asOf.point = pointById[id] ? id : 'today';
    state.asOf.from = null;
    render();
  }

  function show(id, remember) {
    const v = views.find((x) => x.id === id) || views[0];
    if (!v) return;
    current = v;
    if (remember) save('ar-view', v.id);
    try {
      if (location.hash.slice(1) !== v.id) history.replaceState(null, '', '#' + v.id);
    } catch (e) {}
    render();
  }

  function openRule(id) {
    const r = byId[id];
    if (!r) return;
    const undone = r.status === 'decided' || r.status === 'proposed';
    const code = (list, sep) =>
      AR.join(
        list.map((f) => html`<code>${f}</code>`),
        sep,
      );
    const facts = [
      [
        'Status',
        html`${statusPill(r)}${r.experimental ? html` ${AR.Pill({ text: 'experimental', tone: 'warn', variant: 'outline' })}` : ''}`,
      ],
      inForce(r) && ['In force since', refHtml(inForce(r).ref)],
      r.repo && ['Scope', 'How this repo works, not the published packages'],
      r.since && ['Since', html`<code>${r.since}</code>`],
      r.target && ['Target', html`<code>${r.target}</code>${undone ? ' (not released yet)' : ''}`],
      r.values && r.values.length && ['Values', code(r.values, ' · ')],
      r.knob && ['Change it', md(r.knob)],
      r.errors && r.errors.length && ['Errors / events', code(r.errors, ' · ')],
      r.code && r.code.length && ['Code', code(r.code, raw('<br>'))],
      r.supersededBy && ['Superseded by', html`<code>${r.supersededBy}</code>`],
      r.aliases && r.aliases.length && ['Old ids', code(r.aliases, ' · ')],
      ['Concept', cName[r.concept] || r.concept],
    ].filter(Boolean);
    const then = asOfOn() ? ruleAt(r, pointOf(state.asOf.point)) : undefined;
    if (then && (then.status !== r.status || then.statement !== r.statement))
      facts.unshift([
        `As of ${pointLabel(pointOf(state.asOf.point))}`,
        html`${statusPill(then)} ${md(then.statement)}`,
      ]);
    const why = currentWhy(r);
    const links = [...(r.related || []), ...(r.supersededBy ? [r.supersededBy] : [])];
    // Views may add facts and sections to the drawer through `drawer(rule, ctx)`.
    const extra = views.map((v) => (v.drawer ? v.drawer(r, ctx) || {} : {}));
    facts.push(...extra.flatMap((x) => x.facts || []));
    const history = html`<ol class="ar-shell-history">
      ${[...r.events].reverse().map(
        (e) =>
          html`<li class="ar-shell-history-item">
            <div class="ar-shell-rail"><i></i><span></span></div>
            <div class="ar-shell-history-body ar-stack" style="--ar-gap: var(--ar-space-1)">
              ${AR.Cluster({ gap: '3', children: html`${eventLabel(e.type)}<span class="ar-shell-date">${e.date}</span>${refHtml(e.ref)}` })}
              <p>${md(e.why)}</p>
              ${e.prev ? html`<p class="ar-shell-prev">Before: ${md(e.prev)}</p>` : ''}
            </div>
          </li>`,
      )}
    </ol>`;
    $('drawer-root').innerHTML = String(
      AR.Drawer({
        labelId: 'd-id',
        title: html`<span class="ar-shell-id">${r.id}</span>
          <p class="ar-shell-statement">${md(r.statement)}</p>`,
        lead: why ? html`<p class="ar-shell-why"><b>Why:</b> ${md(why.why)}</p>` : '',
        facts,
        sections: [
          { heading: 'History · newest first', body: history },
          ...(links.length
            ? [
                {
                  heading: 'Related rules',
                  body: AR.Cluster({
                    gap: '3',
                    children: links.map(
                      (x) => html`<button class="ar-shell-related" data-id="${x}">${x}</button>`,
                    ),
                  }),
                },
              ]
            : []),
          ...extra.flatMap((x) => x.sections || []),
        ],
      }),
    );
    document.querySelector('.ar-drawer-close').focus();
  }
  function closeRule() {
    $('drawer-root').innerHTML = '';
  }

  function setSymbol(x) {
    state.symbol = SYMBOLS.includes(x) ? x : '';
    const f = $('sym');
    if (f) f.value = state.symbol;
    render();
  }

  function setTheme(t) {
    const root = document.documentElement;
    if (t === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    document
      .querySelectorAll('#theme [data-t]')
      .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
    save('ar-theme', t);
  }

  function start() {
    document.title = DATA.config.title;
    frame();
    $('q').addEventListener('input', (e) => {
      state.query = e.target.value.trim().toLowerCase();
      render();
    });
    // "As of": while the range is dragged only its label follows; letting go
    // (or a key) shows the point. The selects pick the compared points.
    document.addEventListener('input', (e) => {
      if (e.target.id !== 'as-of-point') return;
      const p = POINTS[+e.target.value];
      const out = document.querySelector('output[for="as-of-point"]');
      if (p && out) out.textContent = pointLabel(p);
    });
    document.addEventListener('change', (e) => {
      if (e.target.id === 'as-of-point' && POINTS[+e.target.value]) {
        setPoint(POINTS[+e.target.value].id);
        document.getElementById('as-of-point')?.focus();
        return;
      }
      if (e.target.id === 'as-of-from' || e.target.id === 'as-of-to') {
        state.asOf[e.target.id === 'as-of-from' ? 'from' : 'to'] = e.target.value;
        render();
      }
    });
    const symField = $('sym');
    if (symField)
      symField.addEventListener('change', (e) => {
        if (SYMBOLS.includes(e.target.value) || e.target.value === '') setSymbol(e.target.value);
      });
    document.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const th = e.target.closest('[data-t]');
      if (th) {
        setTheme(th.dataset.t);
        return;
      }
      const tab = e.target.closest('[data-view]');
      if (tab) {
        show(tab.dataset.view, true);
        return;
      }
      const step = e.target.closest('[data-stepper="as-of-point"]');
      if (step) {
        const i = POINTS.findIndex((x) => x.id === pointOf(state.asOf.point).id);
        const next = POINTS[i + Number(step.dataset.step)];
        if (next) setPoint(next.id);
        return;
      }
      if (e.target.closest('[data-asof="today"]')) {
        setPoint('today');
        return;
      }
      if (e.target.closest('[data-compare]')) {
        state.asOf.compare = !state.asOf.compare;
        render();
        return;
      }
      const f = e.target.closest('[data-s]');
      if (f) {
        const s = f.dataset.s;
        state.on.has(s) ? state.on.delete(s) : state.on.add(s);
        render();
        return;
      }
      if (e.target.closest('[data-close]')) {
        closeRule();
        return;
      }
      if (current && current.onClick && current.onClick(e, ctx)) return;
      const kw = e.target.closest('[data-kw]');
      if (kw) {
        const k = kw.dataset.kw;
        if (kw.closest('.ar-drawer')) {
          closeRule();
          state.keywords = new Set([k]);
        } else state.keywords.has(k) ? state.keywords.delete(k) : state.keywords.add(k);
        render();
        return;
      }
      const sym = e.target.closest('[data-sym]');
      if (sym) {
        setSymbol(sym.dataset.sym);
        closeRule();
        return;
      }
      if (e.target.closest('[data-sym-clear]')) {
        setSymbol('');
        return;
      }
      const t = e.target.closest('[data-id]');
      if (t) openRule(t.dataset.id);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeRule();
    });
    window.addEventListener('hashchange', () => show(location.hash.slice(1), true));
    setTheme(load('ar-theme') || 'system');
    $('note').textContent =
      `${RULES.length} rules in ${CONCEPTS.length} concepts, built from ${DATA.config.rulesDir} by pnpm rules:board.`;
    show(location.hash.slice(1) || load('ar-view') || '', false);
  }

  return { view, start, ctx };
})();
