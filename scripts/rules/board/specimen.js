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

    // A sample Sankey: three sources into two targets, coloured by kind.
    const sk = AR.chart.sankey({
      left: [
        { key: 'a', label: 'Source A' },
        { key: 'b', label: 'Source B' },
        { key: 'c', label: 'Source C' },
      ],
      right: [
        { key: 'x', label: 'Target X' },
        { key: 'y', label: 'Target Y' },
      ],
      flows: [
        { from: 'a', to: 'x', value: 6, kind: 'one' },
        { from: 'a', to: 'y', value: 2, kind: 'two' },
        { from: 'b', to: 'x', value: 3, kind: 'one' },
        { from: 'c', to: 'y', value: 4, kind: 'three' },
      ],
      width: W - 160,
      height: 150,
    });
    const kinds = AR.chart.slots([
      { key: 'one', label: 'One', count: 9 },
      { key: 'two', label: 'Two', count: 2 },
      { key: 'three', label: 'Three', count: 4 },
    ]);
    const sankey = AR.ChartFrame({
      title: 'A Sankey',
      sub: 'sankey() lays out nodes and ribbons; ribbons are paths with the ar-chart-ribbon class.',
      legend: AR.chart.legendFor(kinds.groups, 'Kinds'),
      body: AR.chart.svg({
        width: W,
        height: 160,
        label: 'Sample Sankey',
        body: html`<g transform="translate(70 4)"
          >${sk.flows.map((f) =>
            AR.chart.path({ d: f.d, slot: kinds.slotOf(f.kind), cls: 'ar-chart-ribbon' }),
          )}${[...sk.left, ...sk.right].map((nd) =>
            AR.chart.rect({ x: nd.x, y: nd.y, width: 8, height: nd.h, cls: 'ar-chart-node' }),
          )}${sk.left.map((nd) =>
            AR.chart.text({ x: -6, y: nd.y + nd.h / 2 + 4, value: nd.label, anchor: 'end' }),
          )}${sk.right.map((nd) =>
            AR.chart.text({ x: nd.x + 14, y: nd.y + nd.h / 2 + 4, value: nd.label }),
          )}</g
        >`,
      }),
      note: 'Sample data.',
    });

    // A sample treemap: squarify() places cells as close to square as it can.
    const tm = AR.chart.squarify(
      cats.map((c) => ({ key: c.key, value: c.count })),
      { width: W, height: 200 },
    );
    const treemap = AR.ChartFrame({
      title: 'A treemap',
      sub: 'Cells use the ar-chart-cell class and a slot.',
      body: AR.chart.svg({
        width: W,
        height: 200,
        label: 'Sample treemap',
        body: tm.map(
          (c) =>
            html`${AR.chart.rect({ x: c.x, y: c.y, width: c.width, height: c.height, slot: s.slotOf(c.key), cls: 'ar-chart-cell' })}${AR.chart.text(
              { x: c.x + 4, y: c.y + 14, value: c.key.toUpperCase() + ' ' + c.value },
            )}`,
        ),
      }),
      note: 'Sample data.',
    });

    // Marks in tones (statuses, events) rather than slots, placed in polar coordinates.
    const toneDots = AR.ChartFrame({
      title: 'Marks in tones, placed by angle',
      body: AR.chart.svg({
        width: 200,
        height: 200,
        label: 'Tone marks around a circle',
        body: html`<g transform="translate(100 100)">
          ${TONES.map((tone, i) => {
            const [cx, cy] = AR.chart.polar(70, -Math.PI / 2 + (2 * Math.PI * i) / TONES.length);
            return AR.chart.circle({ cx, cy, r: 8, tone });
          })}
        </g>`,
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
              html`<p>Split, side at the end</p>`,
              AR.Split({
                gap: '5',
                end: true,
                children: html`<div class="ar-specimen-box">Main</div>
                  <div class="ar-specimen-box">Side</div>`,
              }),
            ],
          }),
        ),
        section(
          'Share bar',
          AR.ShareBar({
            label: 'Sample shares',
            parts: [
              { key: 'a', label: 'One', value: 5, slot: 1 },
              { key: 'b', label: 'Two', value: 3, slot: 2 },
              { key: 'c', label: 'Three', value: 2, slot: 3 },
              { key: 'd', label: 'Other', value: 1, slot: 'other' },
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
              AR.Chip({
                label: 'With a chart swatch',
                pressed: true,
                count: 7,
                slot: 2,
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
          AR.Stack({
            gap: '4',
            children: [
              AR.Legend({
                label: 'Sample legend',
                items: SLOTS.map((sl) => ({ label: 'Slot ' + sl, slot: sl, value: 10 })),
              }),
              AR.Legend({
                label: 'A legend in tones',
                items: TONES.map((tone) => ({ label: tone, tone })),
              }),
            ],
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
        section(
          'Charts',
          AR.Stack({ gap: '7', children: [chart, timeAxis, toneDots, sankey, treemap] }),
        ),
        section(
          'Event symbols',
          AR.Stack({
            gap: '5',
            children: [
              html`<p>
                Five families, one colour each (--ar-event-*); shape and fill tell the types apart.
              </p>`,
              AR.Cluster({
                gap: '4',
                children: AR.events.ORDER.map((type) =>
                  AR.Chip({
                    label: AR.events.typeOf(type).label,
                    icon: AR.EventIcon({ type }),
                    pressed: true,
                  }),
                ),
              }),
            ],
          }),
        ),
        section(
          'Heat and strip',
          AR.Stack({
            gap: '5',
            children: [
              AR.HeatRamp({ label: 'Count' }),
              AR.chart.svg({
                width: 7 * 30,
                height: 30,
                label: 'Heat cells, counts 0 to 8',
                body: [0, 1, 2, 3, 5, 6, 8].map((count, i) =>
                  AR.chart.heatCell({ x: i * 30 + 1, y: 1, width: 28, height: 28, count }),
                ),
              }),
              AR.chart.strip({
                counts: [2, 5, 0, 9, 3, 1, 7, 4, 0, 6],
                width: W,
                height: 56,
                selected: [3, 6],
                labels: [
                  { index: 0, text: 'first' },
                  { index: 9, text: 'last' },
                ],
                label: 'A strip with a selected range',
              }),
            ],
          }),
        ),
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
