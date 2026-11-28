// The rules page's shell (ADR 0026, amended 2026-11-28): the data, shared
// helpers, the status filters and search, the tabs (routed by the URL's hash),
// the theme and the rule drawer. Each view registers itself with
// `Rules.view({...})` from its own file in views/, and `Rules.start()` runs
// last. Views get everything through the `ctx` passed to their functions.
const Rules = (() => {
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
  const DIM = ['withdrawn', 'rejected', 'superseded'];
  const byId = Object.fromEntries(
    RULES.flatMap((r) => [[r.id, r], ...(r.aliases || []).map((a) => [a, r])]),
  );
  const cName = Object.fromEntries(CONCEPTS.map((c) => [c.id, c.name]));
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m],
    );
  const md = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  const fmtDate = (d) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const refLabel = (ref) => (REFS[ref] ? REFS[ref].label : ref);
  const refHtml = (ref) => {
    const r = REFS[ref];
    return r && r.url
      ? `<a class="ref" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.label)}</a>`
      : `<span class="ref">${esc(refLabel(ref))}</span>`;
  };
  const inForce = (r) => (r.repo ? r.events.find((e) => e.type === 'built') : undefined);
  const currentWhy = (r) => {
    for (let i = r.events.length - 1; i >= 0; i--) {
      const t = r.events[i].type;
      if (t === 'decided' || t === 'amended' || t === 'clarified') return r.events[i];
    }
    return undefined;
  };
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

  // Views, sorted by `order`. A view is { id, label, order, render(ctx) → HTML,
  // controls?(ctx) → HTML for the header, onClick?(event, ctx) → true when handled,
  // mount?(ctx) after its HTML is in the page }.
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
    DIM,
    byId,
    cName,
    esc,
    md,
    fmtDate,
    refLabel,
    refHtml,
    inForce,
    currentWhy,
    load,
    save,
    state,
    matches,
    render: () => render(),
    openRule: (id) => openRule(id),
  };

  function renderFilters() {
    const counts = {};
    RULES.forEach((r) => (counts[r.status] = (counts[r.status] || 0) + 1));
    document.getElementById('filters').innerHTML = Object.keys(STATUS)
      .map(
        (s) =>
          `<button class="chip-f" aria-pressed="${state.on.has(s)}" data-s="${s}"><span class="dot ${s}"></span>${STATUS[s]}<span class="n">${counts[s] || 0}</span></button>`,
      )
      .join('');
  }
  function renderTabs() {
    document.getElementById('tabs').innerHTML = views
      .map(
        (v) =>
          `<button role="tab" id="tab-${esc(v.id)}" data-view="${esc(v.id)}" aria-selected="${v === current}">${esc(v.label)}</button>`,
      )
      .join('');
  }
  function render() {
    if (!current) return;
    renderTabs();
    const controls = document.getElementById('view-controls');
    const c = current.controls ? current.controls(ctx) : '';
    controls.innerHTML = c;
    controls.hidden = !c;
    renderFilters();
    document.getElementById('view').innerHTML = current.render(ctx);
    if (current.mount) current.mount(ctx);
  }
  function show(id, remember) {
    const v = views.find((x) => x.id === id) || views[0];
    if (!v) return;
    current = v;
    if (remember) save('rb-view', v.id);
    try {
      if (location.hash.slice(1) !== v.id) history.replaceState(null, '', '#' + v.id);
    } catch (e) {}
    render();
  }

  function openRule(id) {
    const r = byId[id];
    if (!r) return;
    const undone = r.status === 'decided' || r.status === 'proposed';
    const rows = [
      [
        'Status',
        `<span class="st ${r.status}">${STATUS[r.status]}</span>${r.experimental ? ' <span class="exp">experimental</span>' : ''}`,
      ],
      inForce(r) && ['In force since', refHtml(inForce(r).ref)],
      r.repo && ['Scope', 'How this repo works, not the published packages'],
      r.since && ['Since', `<code>${esc(r.since)}</code>`],
      r.target && ['Target', `<code>${esc(r.target)}</code>${undone ? ' (not released yet)' : ''}`],
      r.values &&
        r.values.length && ['Values', r.values.map((f) => `<code>${esc(f)}</code>`).join(' · ')],
      r.knob && ['Change it', md(r.knob)],
      r.errors &&
        r.errors.length && [
          'Errors / events',
          r.errors.map((f) => `<code>${esc(f)}</code>`).join(' · '),
        ],
      r.code && r.code.length && ['Code', r.code.map((f) => `<code>${esc(f)}</code>`).join('<br>')],
      r.supersededBy && ['Superseded by', `<code>${esc(r.supersededBy)}</code>`],
      r.aliases &&
        r.aliases.length && ['Old ids', r.aliases.map((f) => `<code>${esc(f)}</code>`).join(' · ')],
      ['Concept', esc(cName[r.concept] || r.concept)],
    ].filter(Boolean);
    const why = currentWhy(r);
    const evs = [...r.events].reverse();
    const links = [...(r.related || []), ...(r.supersededBy ? [r.supersededBy] : [])];
    document.getElementById('drawer-root').innerHTML = `<div class="scrim" data-close></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="d-id">
    <div class="d-top"><div><span class="rid" id="d-id">${esc(r.id)}</span><p class="d-stmt">${md(r.statement)}</p>
      ${why ? `<p class="why-now"><b>Why:</b> ${md(why.why)}</p>` : ''}</div>
      <button class="close" data-close aria-label="Close">×</button></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <h3 class="sec-h">History · newest first</h3>
    <ol class="tl">${evs
      .map(
        (e) => `<li><div class="rail"><i></i><span></span></div><div class="body">
      <div class="line1"><span class="ev ${e.type}">${e.type}</span><span class="date">${esc(e.date)}</span>${refHtml(e.ref)}</div>
      <p class="why">${md(e.why)}</p>${e.prev ? `<p class="prev">Before: ${md(e.prev)}</p>` : ''}</div></li>`,
      )
      .join('')}</ol>
    ${links.length ? `<h3 class="sec-h">Related rules</h3><div class="related">${links.map((x) => `<button data-id="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
  </aside>`;
    document.querySelector('.drawer .close').focus();
  }
  function closeRule() {
    document.getElementById('drawer-root').innerHTML = '';
  }

  function setTheme(t) {
    const root = document.documentElement;
    if (t === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    document
      .querySelectorAll('#theme button')
      .forEach((b) => b.setAttribute('aria-selected', b.dataset.t === t));
    save('rb-theme', t);
  }

  function start() {
    document.title = DATA.config.title;
    document.getElementById('title').textContent = DATA.config.title;
    document.getElementById('q').addEventListener('input', (e) => {
      state.query = e.target.value.trim().toLowerCase();
      render();
    });
    document.getElementById('theme').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setTheme(b.dataset.t);
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const tab = e.target.closest('[data-view]');
      if (tab) {
        show(tab.dataset.view, true);
        return;
      }
      const f = e.target.closest('.chip-f');
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
    setTheme(load('rb-theme') || 'system');
    document.getElementById('note').textContent =
      `${RULES.length} rules in ${CONCEPTS.length} concepts, built from ${DATA.config.rulesDir} by pnpm rules:board.`;
    show(location.hash.slice(1) || load('rb-view') || '', false);
  }

  return { view, start, ctx };
})();
