// The Board tab: concepts as columns, rules as cards (ADR 0026, decision 15).
Rules.view({
  id: 'board',
  label: 'Board',
  order: 10,
  render(ctx) {
    const { rules, concepts, esc, md, fmtDate, refLabel, inForce, STATUS, DIM, matches } = ctx;
    const card = (r) => {
      const last = r.events[r.events.length - 1];
      const built = inForce(r);
      const ver = built
        ? 'in force since ' + refLabel(built.ref)
        : r.since
          ? 'since ' + r.since
          : r.target
            ? 'target ' + r.target
            : '';
      return `<button class="card${DIM.includes(r.status) ? ' dim' : ''}" data-id="${esc(r.id)}">
    <div class="card-top"><span class="rid">${esc(r.id)}</span><span class="facts">${r.experimental ? '<span class="exp">experimental</span>' : ''}${r.repo ? '<span class="fact">repo</span>' : ''}<span class="st ${r.status}">${STATUS[r.status]}</span></span></div>
    <p class="stmt">${md(r.statement)}</p>
    ${r.values && r.values.length ? `<div class="facts">${r.values.map((f) => `<span class="fact">${esc(f)}</span>`).join('')}</div>` : ''}
    <div class="card-foot"><span>${r.events.length} event${r.events.length > 1 ? 's' : ''} · ${last.type} ${fmtDate(last.date)}</span><span>${esc(ver)}</span></div>
  </button>`;
    };
    if (rules.length === 0)
      return `<p class="empty-board">No rules yet. Add them to the JSON files in ${esc(ctx.config.rulesDir)}, then run pnpm rules:board again.</p>`;
    return `<div class="board">${concepts
      .filter((c) => rules.some((r) => r.concept === c.id))
      .map((c) => {
        const rs = rules.filter((r) => r.concept === c.id && matches(r));
        const total = rules.filter((r) => r.concept === c.id).length;
        return `<section class="col"><div class="col-h"><h2>${esc(c.name)}</h2><span class="meta">${rs.length}/${total}</span></div>
      <p class="col-desc">${esc(c.description)}</p>
      ${rs.length ? rs.map(card).join('') : '<div class="empty">No rules match.</div>'}</section>`;
      })
      .join('')}</div>`;
  },
});
