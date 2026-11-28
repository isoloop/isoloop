// The Agenda tab: every event, newest first, by day or by release (ADR 0026, decision 15).
// It follows "as of": at a past point, only the events up to that day.
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
  const groupOf = (ctx) => (group ??= ctx.load('ar-group') === 'version' ? 'version' : 'day');

  Rules.view({
    id: 'agenda',
    label: 'Agenda',
    order: 20,
    asOf: true,
    controls(ctx) {
      return AR.Tabs({
        items: [
          { id: 'day', label: 'By day' },
          { id: 'version', label: 'By version' },
        ],
        selected: groupOf(ctx),
        role: 'radio',
        key: 'g',
        label: 'Agenda grouping',
      });
    },
    onClick(e, ctx) {
      const b = e.target.closest('[data-g]');
      if (!b) return false;
      group = b.dataset.g;
      ctx.save('ar-group', group);
      ctx.render();
      return true;
    },
    render(ctx) {
      const { html, md } = AR;
      const { rules, cName, refLabel, matches, eventLabel } = ctx;
      const g = groupOf(ctx);
      const RELEASES = releasesOf(ctx.allRules);
      const releaseOf = (e) => {
        if (e.type === 'shipped') return e.ref;
        const rel = RELEASES.find((x) => x.date >= e.date);
        return rel ? rel.tag : 'Unreleased';
      };
      const rowsHtml = (list) =>
        html`<div class="ar-agenda-rows">
          ${list.map(
            (e) =>
              html`<button class="ar-agenda-row" data-id="${e.r.id}">
                ${eventLabel(e.type)}
                <span class="ar-agenda-what"
                  ><b>${e.r.id}</b
                  ><span class="ar-agenda-concept">${cName[e.r.concept] || e.r.concept}</span
                  ><span class="ar-agenda-why">${md(e.why)}</span></span
                >
                <span class="ar-agenda-src"
                  >${g === 'version' ? e.date + ' · ' : ''}${refLabel(e.ref)}</span
                >
              </button>`,
          )}
        </div>`;
      const evs = [];
      rules.filter(matches).forEach((r) => r.events.forEach((e) => evs.push({ ...e, r })));
      evs.sort((a, b) => b.date.localeCompare(a.date) || a.r.concept.localeCompare(b.r.concept));
      if (!evs.length) return AR.EmptyState({ text: 'No events match.' });
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
      return AR.Stack({
        gap: '7',
        children: keys.map((k) => {
          const list = groups.get(k);
          const n = `${list.length} event${list.length > 1 ? 's' : ''}`;
          let h;
          if (g === 'version') {
            const rel = RELEASES.find((x) => x.tag === k);
            h = html`<b>${k}</b>${rel ? rel.date + ' · ' : ''}${n}`;
          } else {
            const dt = new Date(k + 'T00:00:00');
            h = html`<b>${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b
              >${dt.toLocaleDateString('en-GB', { weekday: 'short' })} ${dt.getFullYear()} · ${n}`;
          }
          return AR.Split({
            gap: '7',
            side: 'date-col',
            as: 'section',
            children: html`<div class="ar-agenda-head">${h}</div>
              ${rowsHtml(list)}`,
          });
        }),
      });
    },
  });
})();
