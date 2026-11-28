// The Board tab: concepts as columns, rules as cards (ADR 0026, decision 15).
Rules.view({
  id: 'board',
  label: 'Board',
  order: 10,
  render(ctx) {
    const { html, md } = AR;
    const { rules, concepts, fmtDate, refLabel, inForce, DIM, matches, statusPill } = ctx;
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
      const dim = DIM.includes(r.status);
      return AR.Card({
        as: 'button',
        dim,
        attrs: { 'data-id': r.id },
        top: [
          html`<span class="ar-board-id">${r.id}</span>`,
          AR.Cluster({
            gap: '3',
            children: html`${r.experimental ? AR.Pill({ text: 'experimental', tone: 'warn', variant: 'outline' }) : ''}${
              r.repo ? AR.Pill({ text: 'repo', variant: 'code' }) : ''
            }${statusPill(r)}`,
          }),
        ],
        body: html`<p class="ar-board-statement" ${AR.attrs({ 'data-dim': dim })}>
            ${md(r.statement)}
          </p>
          ${
            r.values && r.values.length
              ? AR.Cluster({
                  gap: '3',
                  children: r.values.map((f) => AR.Pill({ text: f, variant: 'code' })),
                })
              : ''
          }`,
        foot: [
          `${r.events.length} event${r.events.length > 1 ? 's' : ''} · ${last.type} ${fmtDate(last.date)}`,
          ver,
        ],
      });
    };
    if (rules.length === 0)
      return AR.EmptyState({
        size: 'l',
        text: `No rules yet. Add them to the JSON files in ${ctx.config.rulesDir}, then run pnpm rules:board again.`,
      });
    return AR.Grid({
      gap: '6',
      min: 'col-min',
      children: concepts
        .filter((c) => rules.some((r) => r.concept === c.id))
        .map((c) => {
          const rs = rules.filter((r) => r.concept === c.id && matches(r));
          const total = rules.filter((r) => r.concept === c.id).length;
          return html`<section class="ar-stack ar-board-col">
            <div class="ar-board-head">
              <h2 class="ar-board-name">${c.name}</h2>
              <span class="ar-board-count">${rs.length}/${total}</span>
            </div>
            <p class="ar-board-desc">${c.description}</p>
            ${rs.length ? rs.map(card) : AR.EmptyState({ text: 'No rules match.' })}
          </section>`;
        }),
    });
  },
});
