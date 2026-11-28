// The Agenda tab: every event, newest first, by day or by release (ADR 0026, decision 15).
(() => {
  let group = null;
  // Releases, from the shipped events: an event belongs to the first release dated on or after it.
  let releases = null;
  const releasesOf = (rules) =>
    (releases ??= [
      ...new Map(
        rules.flatMap((r) =>
          r.events.filter((e) => e.type === 'shipped').map((e) => [e.ref, e.date]),
        ),
      ).entries(),
    ]
      .map(([tag, date]) => ({ tag, date }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.tag.localeCompare(b.tag)));
  const groupOf = (ctx) => (group ??= ctx.load('rb-group') === 'version' ? 'version' : 'day');

  Rules.view({
    id: 'agenda',
    label: 'Agenda',
    order: 20,
    controls(ctx) {
      const g = groupOf(ctx);
      return `<div class="tabs" role="radiogroup" aria-label="Agenda grouping" id="group">
        <button role="radio" data-g="day" aria-selected="${g === 'day'}">By day</button>
        <button role="radio" data-g="version" aria-selected="${g === 'version'}">By version</button>
      </div>`;
    },
    onClick(e, ctx) {
      const b = e.target.closest('[data-g]');
      if (!b) return false;
      group = b.dataset.g;
      ctx.save('rb-group', group);
      ctx.render();
      return true;
    },
    render(ctx) {
      const { rules, esc, md, cName, refLabel, matches } = ctx;
      const g = groupOf(ctx);
      const RELEASES = releasesOf(rules);
      const releaseOf = (e) => {
        if (e.type === 'shipped') return e.ref;
        const rel = RELEASES.find((x) => x.date >= e.date);
        return rel ? rel.tag : 'Unreleased';
      };
      const rowsHtml = (list) =>
        `<div class="rows">${list
          .map(
            (e) => `<button class="row" data-id="${esc(e.r.id)}">
    <span class="ev ${e.type}">${e.type}</span>
    <span class="what"><b>${esc(e.r.id)}</b><span class="cpt">${esc(cName[e.r.concept] || e.r.concept)}</span><span class="why">${md(e.why)}</span></span>
    <span class="src">${g === 'version' ? esc(e.date) + ' · ' : ''}${esc(refLabel(e.ref))}</span></button>`,
          )
          .join('')}</div>`;
      const evs = [];
      rules.filter(matches).forEach((r) => r.events.forEach((e) => evs.push({ ...e, r })));
      evs.sort((a, b) => b.date.localeCompare(a.date) || a.r.concept.localeCompare(b.r.concept));
      if (!evs.length) return '<div class="empty">No events match.</div>';
      const groups = new Map();
      for (const e of evs) {
        const k = g === 'version' ? releaseOf(e) : e.date;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(e);
      }
      let keys = [...groups.keys()];
      if (g === 'version') {
        const order = ['Unreleased', ...RELEASES.map((x) => x.tag).reverse()];
        keys = keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      }
      return `<div class="agenda">${keys
        .map((k) => {
          const list = groups.get(k);
          const n = `${list.length} event${list.length > 1 ? 's' : ''}`;
          let h;
          if (g === 'version') {
            const rel = RELEASES.find((x) => x.tag === k);
            h = `<b>${esc(k)}</b>${rel ? esc(rel.date) + ' · ' : ''}${n}`;
          } else {
            const dt = new Date(k + 'T00:00:00');
            h = `<b>${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b>${dt.toLocaleDateString('en-GB', { weekday: 'short' })} ${dt.getFullYear()} · ${n}`;
          }
          return `<section class="day"><div class="day-h">${h}</div>${rowsHtml(list)}</section>`;
        })
        .join('')}</div>`;
    },
  });
})();
