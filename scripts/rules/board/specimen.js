// The specimen page (ADR 0026, amended 2026-11-28): every token, type step,
// layout primitive, component and chart part, on one tab. `rules:board
// --specimen` builds it in place of the views.
Rules.view({
  id: 'specimen',
  label: 'Specimen',
  order: 0,
  render() {
    const { html } = AR;
    const COLORS = [
      'bg',
      'surface',
      'sunk',
      'line',
      'border',
      'fg',
      'muted',
      'accent',
      'accent-soft',
      'on-accent',
      'focus',
      'ok',
      'ok-soft',
      'info',
      'info-soft',
      'warn',
      'warn-soft',
      'off',
      'off-soft',
      'gone',
      'gone-soft',
      'tooltip-bg',
      'tooltip-fg',
      'grid',
      'axis',
    ];
    const SLOTS = ['1', '2', '3', '4', '5', '6', '7', '8', 'other'];
    const SPACE = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    const TEXT = ['xs', 's', 'm', 'l', 'xl'];
    const TONES = ['ok', 'info', 'warn', 'off', 'gone', 'accent'];
    const section = (title, body) =>
      html`<section class="ar-stack ar-specimen-section">
        <h2 class="ar-specimen-h">${title}</h2>
        ${body}
      </section>`;
    const swatch = (name, value) =>
      html`<div class="ar-specimen-swatch">
        <span class="ar-specimen-chip" style="background: var(--ar-${name})"></span
        ><code>--ar-${name}</code>${value ? html`<span>${value}</span>` : ''}
      </div>`;

    // A sample chart: 11 categories, so 3 fall into Other.
    const cats = 'abcdefghijk'
      .split('')
      .map((k, i) => ({ key: k, label: 'Category ' + k.toUpperCase(), count: 24 - i * 2 }));
    const s = AR.chart.slots(cats);
    const W = 480;
    const H = 200;
    const x = AR.chart.scaleBand(
      cats.map((c) => c.key),
      [40, W - 10],
      0.2,
    );
    const y = AR.chart.scaleLinear([0, 25], [H - 30, 10]);
    const bars = cats.map((c) =>
      AR.chart.rect({
        x: x(c.key),
        y: y(c.count),
        width: x.bandwidth(),
        height: y(0) - y(c.count),
        slot: s.slotOf(c.key),
      }),
    );
    const t = AR.chart.scaleTime(['2026-11-03', '2026-11-28'], [40, W - 10]);
    const chart = AR.ChartFrame({
      title: 'Bars by category',
      sub: 'Scales, axes, grid lines, slots and a legend; more than 8 categories are grouped.',
      legend: AR.chart.legendFor(s.groups, 'Categories'),
      body: AR.chart.svg({
        width: W,
        height: H,
        label: 'Sample bar chart',
        body: html`${AR.chart.axisLeft({ scale: y, x: 40, count: 5, gridTo: W - 10 })}${bars}${AR.chart.line({ x1: 40, y1: H - 30, x2: W - 10, y2: H - 30, cls: 'ar-chart-axis-line' })}${cats.map(
          (c) =>
            AR.chart.text({
              x: x(c.key) + x.bandwidth() / 2,
              y: H - 14,
              value: c.key.toUpperCase(),
              anchor: 'middle',
              cls: 'ar-chart-axis',
            }),
        )}`,
      }),
      note: 'Sample data.',
    });
    const timeAxis = AR.ChartFrame({
      title: 'A time axis',
      body: AR.chart.svg({
        width: W,
        height: 40,
        label: 'Time axis',
        body: AR.chart.axisBottom({ scale: t, y: 10, count: 5, format: (d) => d.slice(5) }),
      }),
    });

    return AR.Stack({
      gap: '9',
      children: [
        section(
          'Semantic colours',
          AR.Grid({ gap: '4', min: 'col-min', children: COLORS.map((c) => swatch(c)) }),
        ),
        section(
          'Chart slots',
          AR.Cluster({ gap: '5', children: SLOTS.map((c) => swatch('cat-' + c)) }),
        ),
        section(
          'Type scale',
          AR.Stack({
            gap: '3',
            children: TEXT.map(
              (t) =>
                html`<p class="ar-specimen-type" style="font-size: var(--ar-text-${t})">
                  --ar-text-${t} · Rules hold one fact 0123456789
                </p>`,
            ),
          }),
        ),
        section(
          'Space',
          AR.Stack({
            gap: '2',
            children: SPACE.map(
              (n) =>
                html`<div class="ar-cluster">
                  <span class="ar-specimen-bar" style="width: var(--ar-space-${n})"></span
                  ><code>--ar-space-${n}</code>
                </div>`,
            ),
          }),
        ),
        section(
          'Layout primitives',
          AR.Stack({
            gap: '5',
            children: [
              html`<p>Stack</p>`,
              AR.Stack({
                gap: '3',
                children: [1, 2, 3].map((i) => html`<div class="ar-specimen-box">Item ${i}</div>`),
              }),
              html`<p>Cluster</p>`,
              AR.Cluster({
                gap: '3',
                children: [1, 2, 3, 4, 5].map(
                  (i) => html`<div class="ar-specimen-box">Item ${i}</div>`,
                ),
              }),
              html`<p>Grid</p>`,
              AR.Grid({
                gap: '4',
                children: [1, 2, 3].map((i) => html`<div class="ar-specimen-box">Cell ${i}</div>`),
              }),
              html`<p>Split</p>`,
              AR.Split({
                gap: '5',
                children: html`<div class="ar-specimen-box">Side</div>
                  <div class="ar-specimen-box">Main</div>`,
              }),
            ],
          }),
        ),
        section(
          'Tabs',
          AR.Tabs({
            items: [
              { id: 'a', label: 'One' },
              { id: 'b', label: 'Two' },
              { id: 'c', label: 'Three' },
            ],
            selected: 'a',
            label: 'Sample tabs',
            key: 'specimen-tab',
          }),
        ),
        section(
          'Pills and dots',
          AR.Cluster({
            gap: '3',
            children: [
              ...TONES.map((tone) => AR.Pill({ text: tone, tone })),
              AR.Pill({ text: 'outline', tone: 'warn', variant: 'outline' }),
              AR.Pill({ text: 'code', variant: 'code' }),
              ...TONES.map((tone) => AR.Dot({ tone })),
            ],
          }),
        ),
        section(
          'Chips',
          AR.Cluster({
            gap: '3',
            children: [
              AR.Chip({
                label: 'Pressed',
                pressed: true,
                count: 12,
                tone: 'ok',
                attrs: { 'data-specimen': '1' },
              }),
              AR.Chip({
                label: 'Not pressed',
                count: 3,
                tone: 'warn',
                attrs: { 'data-specimen': '1' },
              }),
            ],
          }),
        ),
        section(
          'Cards',
          AR.Grid({
            gap: '4',
            children: [
              AR.Card({
                top: ['id.one', AR.Pill({ text: 'Active', tone: 'ok' })],
                body: html`<p>A card with a top and a foot.</p>`,
                foot: ['3 events', 'since 0.1.0'],
              }),
              AR.Card({
                dim: true,
                top: ['id.two', AR.Pill({ text: 'Rejected', tone: 'off' })],
                body: html`<p>A dimmed card.</p>`,
              }),
            ],
          }),
        ),
        section(
          'Table',
          AR.Table({
            caption: 'A table with numbers',
            columns: [
              { key: 'name', label: 'Name' },
              { key: 'n', label: 'Rules', align: 'end' },
            ],
            rows: [
              { name: 'Supervision', n: 25 },
              { name: 'Durability', n: 26 },
              { name: 'Bus', n: 123 },
            ],
          }),
        ),
        section(
          'Legend',
          AR.Legend({
            label: 'Sample legend',
            items: SLOTS.map((sl) => ({ label: 'Slot ' + sl, slot: sl, value: 10 })),
          }),
        ),
        section('Tooltip', AR.Tooltip({ content: 'A tooltip, placed in flow here.' })),
        section('Empty state', AR.EmptyState({ text: 'No rules match.' })),
        section(
          'Field and toolbar',
          AR.Toolbar({
            label: 'Sample toolbar',
            children: [
              AR.Field({ id: 'specimen-field', label: 'A field', placeholder: 'Type…' }),
              AR.Chip({ label: 'A chip' }),
            ],
          }),
        ),
        section('Charts', AR.Stack({ gap: '7', children: [chart, timeAxis] })),
        section(
          'Drawer',
          html`<p>
            Open the drawer from a card on the rules page; its markup is AR.Drawer({ title, lead,
            facts, sections }).
          </p>`,
        ),
      ],
    });
  },
});
