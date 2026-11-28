// The rules page's shell (ADR 0026, amended 2026-11-28): the data, the shared
// status filters and search, the tabs (routed by the URL's hash), the theme
// switch and the rule drawer, all built from the design system's components.
// Each view registers itself with `Rules.view({...})` from views/, and
// `Rules.start()` runs last. Views get everything through `ctx`.
const Rules = (() => {
  const { html, raw, md, attrs } = AR;
  const DATA = /*RULES_DATA*/ null || {
    config: { title: 'Rules', rulesDir: 'docs/rules' },
    concepts: [],
    rules: [],
    refs: {},
    keywords: [],
    model: { symbols: {}, links: [], tooCommon: [], keywordRules: {} },
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

  // Shared state: the status filters and the search apply to every view.
  const state = { query: '', on: new Set(['active', 'decided', 'proposed']) };
  function matches(r) {
    if (!state.on.has(r.status)) return false;
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
  // handled, mount?(ctx) after its HTML is in the page }.
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

  const ctx = {
    data: DATA,
    config: DATA.config,
    concepts: CONCEPTS,
    rules: RULES,
    refs: REFS,
    keywords: DATA.keywords || [],
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
            <div class="ar-cluster" id="filters"></div>`,
        })}
        <main id="view"></main>
        <p class="ar-shell-note" id="note"></p>
      </div>`,
    );
    $('ar-app').querySelector('[role="radiogroup"][aria-label="Theme"]').id = 'theme';
  }

  function renderFilters() {
    const counts = {};
    RULES.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
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
    $('view').innerHTML = String(current.render(ctx));
    if (current.mount) current.mount(ctx);
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
    const why = currentWhy(r);
    const links = [...(r.related || []), ...(r.supersededBy ? [r.supersededBy] : [])];
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
        ],
      }),
    );
    document.querySelector('.ar-drawer-close').focus();
  }
  function closeRule() {
    $('drawer-root').innerHTML = '';
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
