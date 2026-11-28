// The design system's tests (ADR 0026, amended 2026-11-28): contrast in every
// theme, the literal ban, and each component and chart helper. The browser
// scripts run in a VM, the same files the page inlines.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { BOARD_DIR, DS_JS } from './build.ts';
import { LITERAL_ALLOW, literalProblems, readSources, stripComments } from './literals.ts';

// --- Loading the browser scripts ---------------------------------------------

interface Safe {
  html: string;
}
type Fn = (...args: unknown[]) => unknown;
type Scale = Fn & { ticks: (n?: number) => unknown[]; bandwidth: () => number; invert: Fn };
interface Slots {
  slotOf: (k: string) => unknown;
  groups: { slot: unknown; count: number }[];
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isFn = (v: unknown): v is Fn => typeof v === 'function';
const isScale = (v: unknown): v is Scale => typeof v === 'function';
const isSafe = (v: unknown): v is Safe => isRec(v) && typeof v['html'] === 'string';
const isSlots = (v: unknown): v is Slots =>
  isRec(v) && Array.isArray(v['groups']) && typeof v['slotOf'] === 'function';
/** `v`, after checking it with `guard`. */
function must<T>(v: unknown, guard: (x: unknown) => x is T, what = 'value'): T {
  if (!guard(v)) throw new Error(`unexpected ${what}`);
  return v;
}

function loadAR(): Record<string, unknown> {
  const ctx = createContext({});
  for (const f of DS_JS) runInContext(readFileSync(join(BOARD_DIR, 'ds', f), 'utf8'), ctx);
  return must(runInContext('globalThis.AR', ctx), isRec, 'AR');
}
const AR = loadAR();
const fn = (name: string): Fn => must(AR[name], isFn, `AR.${name}`);
const chartFn = (name: string): Fn =>
  must(must(AR['chart'], isRec, 'AR.chart')[name], isFn, `AR.chart.${name}`);
/** Markup with formatting whitespace removed, so tests don't depend on how the sources are wrapped. */
const norm = (s: string): string =>
  s
    .replace(/\s+/g, ' ')
    .replace(/>\s+/g, '>')
    .replace(/\s+</g, '<')
    .replace(/\s+\/?>/g, '>')
    .trim();
const str = (v: unknown): string => norm(String(v));
/** A tagged-template call on AR.html. */
const html = (strings: TemplateStringsArray, ...values: unknown[]): Safe =>
  must(fn('html')(strings, ...values), isSafe, 'SafeHtml');

// --- Contrast ----------------------------------------------------------------

const THEMES_DIR = join(BOARD_DIR, 'ds', 'themes');
const themeNames = readdirSync(THEMES_DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => f.slice(0, -4));

function block(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(at, css.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--ar-([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}
const rgb = (hex: string): number[] => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = (hex: string): number => {
  const c = rgb(hex).map((x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string): number => {
  const [la, lb] = [lum(a), lum(b)];
  const [x, y] = la >= lb ? [la, lb] : [lb, la];
  return (x + 0.05) / (y + 0.05);
};

/** Text and background pairs that must reach 4.5:1, then graphics at 3:1. */
const TEXT_PAIRS: [string, string][] = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['fg', 'sunk'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'sunk'],
  ['accent', 'surface'],
  ['accent', 'bg'],
  ['on-accent', 'accent'],
  ['fg', 'accent-soft'],
  ['ok', 'ok-soft'],
  ['info', 'info-soft'],
  ['warn', 'warn-soft'],
  ['warn', 'surface'],
  ['off', 'off-soft'],
  ['gone', 'gone-soft'],
  ['tooltip-fg', 'tooltip-bg'],
  ['axis', 'surface'],
];
const GRAPHIC_SLOTS = ['1', '2', '3', '4', '5', '6', '7', '8', 'other'];

describe('contrast, every theme in light and dark', () => {
  it('has the themes', () => {
    expect(themeNames).toEqual(expect.arrayContaining(['neutral', 'isoloop']));
  });
  for (const name of themeNames) {
    const css = readFileSync(join(THEMES_DIR, `${name}.css`), 'utf8');
    const light = block(css, ':root');
    const dark = block(css, ":root[data-theme='dark']");
    it(`${name}: the system-dark block matches the explicit dark block`, () => {
      expect(block(css, ":root:not([data-theme='light'])")).toEqual(dark);
    });
    for (const [mode, t] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      it(`${name} ${mode}: text pairs reach WCAG AA (4.5:1)`, () => {
        const low = TEXT_PAIRS.map(([f, b]) => [f, b, contrast(t[f]!, t[b]!)] as const).filter(
          ([, , c]) => c < 4.5,
        );
        expect(low).toEqual([]);
      });
      it(`${name} ${mode}: chart slots reach 3:1 against the surface`, () => {
        const low = GRAPHIC_SLOTS.filter((s) => contrast(t[`cat-${s}`]!, t['surface']!) < 3);
        expect(low).toEqual([]);
      });
    }
  }
});

// --- The literal ban ---------------------------------------------------------

describe('the literal ban', () => {
  it('passes on the page sources', () => {
    expect(literalProblems(readSources(BOARD_DIR))).toEqual([]);
  });
  it('fails on each kind of literal, outside the allowlist only', () => {
    const text = [
      '.a { color: #fff; }',
      '.b { background: rgb(0 0 0); }',
      '.c { font-size: 13px; }',
      '.d { font: 500 12px var(--ar-font-sans); }',
      ".e { font-family: 'Archivo'; }",
      '.f { padding: 4px 8px; }',
      '.g { margin-top: 1.5rem; }',
      '.ok { padding: var(--ar-space-4); margin: 0; font-size: var(--ar-text-s); }',
      '/* #abcdef in a comment */',
      "const s = '&#39;' + '#' + id;",
    ].join('\n');
    const problems = literalProblems([{ path: 'views/x.css', text }]);
    expect(problems.map((p) => p.message)).toEqual([
      'line 1: a hex colour outside the token files; use a token',
      'line 2: a colour function outside the token files; use a token',
      'line 3: a font size outside the token files; use a token',
      'line 4: a font size in `font:` outside the token files; use a token',
      'line 5: a font family outside the token files; use a token',
      'line 6: a spacing value outside the token files; use a token',
      'line 7: a spacing value outside the token files; use a token',
    ]);
    for (const allowed of LITERAL_ALLOW) {
      const path = allowed.endsWith('/') ? `${allowed}x.css` : allowed;
      expect(literalProblems([{ path, text }])).toEqual([]);
    }
  });
  it('keeps line numbers when it strips comments', () => {
    expect(stripComments('a\n/* b\nc */\nd').split('\n')).toHaveLength(4);
  });
});

// --- html, raw, attrs --------------------------------------------------------

describe('the html tag', () => {
  it('escapes values and keeps SafeHtml', () => {
    const inner = html`<b>${'<i>'}</b>`;
    expect(inner.html).toBe('<b>&lt;i&gt;</b>');
    expect(html`<p>${inner}${'"&\''}</p>`.html).toBe('<p><b>&lt;i&gt;</b>&quot;&amp;&#39;</p>');
  });
  it('joins arrays and drops null, undefined and booleans', () => {
    expect(html`${['a', fn('raw')('<br>'), null, undefined, false, true, 0]}`.html).toBe('a<br>0');
  });
  it('raw() marks HTML as safe, md() turns backticks into code', () => {
    expect(html`${fn('raw')('<hr>')}`.html).toBe('<hr>');
    expect(str(fn('md')('a `<b>` c'))).toBe('a<code>&lt;b&gt;</code>c');
  });
  it('attrs() writes, escapes, drops and refuses bad names', () => {
    expect(str(fn('attrs')({ a: 'x"y', b: true, c: false, d: null }))).toBe('a="x&quot;y" b');
    expect(() => fn('attrs')({ 'on click': 'x' })).toThrow(/bad attribute name/);
  });
});

// --- Components --------------------------------------------------------------

describe('layout primitives', () => {
  it('set their settings from token names only', () => {
    expect(str(fn('Stack')({ gap: '4', children: 'x' }))).toBe(
      '<div class="ar-stack" style="--ar-gap: var(--ar-space-4)">x</div>',
    );
    expect(str(fn('Grid')({ min: 'col-min', children: '' }))).toContain(
      '--ar-min: var(--ar-col-min)',
    );
    expect(str(fn('Split')({ side: 'date-col', as: 'section', children: '' }))).toMatch(
      /^<section class="ar-split" style="--ar-side: var\(--ar-date-col\)">/,
    );
    expect(str(fn('Cluster')({ justify: 'space-between', children: '' }))).toContain(
      '--ar-justify: space-between',
    );
    expect(() => fn('Stack')({ gap: '4px; color: red' })).toThrow(/isn't a token name/);
    expect(() => fn('Stack')({ as: 'div onclick' })).toThrow(/bad tag/);
  });
});

describe('components', () => {
  it('Tabs marks the selected item and carries ids in a data attribute', () => {
    const h = str(
      fn('Tabs')({
        items: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        selected: 'b',
        label: 'Views',
        idPrefix: 'tab-',
      }),
    );
    expect(h).toContain('role="tablist" aria-label="Views"');
    expect(h).toContain('id="tab-a" data-view="a" aria-selected="false"');
    expect(h).toContain('id="tab-b" data-view="b" aria-selected="true"');
    const r = str(
      fn('Tabs')({ items: [{ id: 'x', label: 'X' }], selected: 'x', role: 'radio', key: 't' }),
    );
    expect(r).toContain('role="radiogroup"');
    expect(r).toContain('role="radio" data-t="x"');
  });
  it('Pill, Dot and Chip carry tones, variants and state', () => {
    expect(str(fn('Pill')({ text: '<x>', tone: 'ok' }))).toBe(
      '<span class="ar-pill" data-tone="ok">&lt;x&gt;</span>',
    );
    expect(str(fn('Pill')({ text: 'c', variant: 'code' }))).toContain('data-variant="code"');
    expect(str(fn('Dot')({ tone: 'warn' }))).toContain('class="ar-dot" data-tone="warn"');
    const chip = str(
      fn('Chip')({ label: 'L', pressed: true, count: 3, tone: 'ok', attrs: { 'data-s': 'x' } }),
    );
    expect(chip).toContain('aria-pressed="true" data-s="x"');
    expect(chip).toContain('<span class="ar-dot" data-tone="ok"></span>L');
    expect(chip).toContain('<span class="ar-chip-count">3</span>');
  });
  it('Card renders as a button or a block, with rows and dimming', () => {
    const c = str(
      fn('Card')({
        as: 'button',
        dim: true,
        attrs: { 'data-id': 'a.b' },
        top: ['id', 'st'],
        body: html`<p>b</p>`,
        foot: ['f', 'g'],
      }),
    );
    expect(c).toMatch(/^<button class="ar-card" data-dim data-id="a\.b">/);
    expect(c).toContain('<div class="ar-card-top"><span>id</span><span>st</span></div><p>b</p>');
    expect(c).toContain('<div class="ar-card-foot"><span>f</span><span>g</span></div>');
    expect(str(fn('Card')({ body: 'x' }))).toBe('<div class="ar-card">x</div>');
  });
  it('Drawer is a labelled modal dialog with facts, sections and close targets', () => {
    const d = str(
      fn('Drawer')({
        labelId: 'd',
        title: 'T',
        facts: [['K', 'V']],
        sections: [{ heading: 'H', body: 'B' }],
      }),
    );
    expect(d).toContain('role="dialog" aria-modal="true" aria-labelledby="d"');
    expect(d).toContain('<dt>K</dt><dd>V</dd>');
    expect(d).toContain('<h3 class="ar-drawer-h">H</h3>B');
    expect(d.match(/data-close/g)).toHaveLength(2);
  });
  it('Table aligns columns and adds row attributes', () => {
    const t = str(
      fn('Table')({
        caption: 'C',
        columns: [
          { key: 'a', label: 'A' },
          { key: 'n', label: 'N', align: 'end' },
        ],
        rows: [{ a: '<x>', n: 3 }],
        rowAttrs: () => ({ 'data-id': 'r' }),
      }),
    );
    expect(t).toContain('<caption>C</caption>');
    expect(t).toContain('<th scope="col" data-align="end">N</th>');
    expect(t).toContain('<tr data-id="r"><td>&lt;x&gt;</td><td data-align="end">3</td></tr>');
  });
  it('Legend, EmptyState, Field, Toolbar, ChartFrame and Tooltip', () => {
    expect(str(fn('Legend')({ items: [{ label: 'A', slot: 2, value: 5 }] }))).toContain(
      '<span class="ar-legend-swatch" data-slot="2"></span>A<span class="ar-legend-value">5</span>',
    );
    expect(str(fn('EmptyState')({ text: 'None', size: 'l' }))).toBe(
      '<p class="ar-empty" data-size="l">None</p>',
    );
    const f = str(fn('Field')({ id: 'q', label: 'Search', type: 'search', hideLabel: true }));
    expect(f).toContain('<label class="ar-field" for="q">');
    expect(f).toContain('class="ar-field-label" data-hidden>Search');
    expect(f).toContain('id="q" type="search"');
    expect(str(fn('Toolbar')({ label: 'Tools', children: 'x' }))).toBe(
      '<div class="ar-toolbar" role="toolbar" aria-label="Tools">x</div>',
    );
    const cf = str(fn('ChartFrame')({ title: 'T', body: 'B', note: 'N' }));
    expect(cf).toMatch(/^<figure class="ar-chart"/);
    expect(cf).toContain(
      '<div class="ar-chart-body">B</div><figcaption class="ar-chart-note">N</figcaption>',
    );
    expect(str(fn('Tooltip')({ content: 'Tip' }))).toContain('role="tooltip" data-static>Tip');
  });
});

// --- The chart toolkit -------------------------------------------------------

describe('the chart toolkit', () => {
  it('picks round ticks', () => {
    expect(chartFn('ticks')(0, 25, 5)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(chartFn('ticks')(0, 1, 4)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it('maps linear, band and time scales', () => {
    const y = must(chartFn('scaleLinear')([0, 10], [100, 0]), isScale);
    expect(y(5)).toBe(50);
    expect(y.invert(25)).toBe(7.5);
    const x = must(chartFn('scaleBand')(['a', 'b'], [0, 100], 0), isScale);
    expect(x('b')).toBe(50);
    expect(x.bandwidth()).toBe(50);
    const t = must(chartFn('scaleTime')(['2026-11-01', '2026-11-11'], [0, 100]), isScale);
    expect(t('2026-11-06')).toBe(50);
    expect(t.ticks(5)).toEqual([
      '2026-11-01',
      '2026-11-03',
      '2026-11-05',
      '2026-11-07',
      '2026-11-09',
      '2026-11-11',
    ]);
  });
  it('gives the 8 biggest categories slots and groups the rest', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, count: i }));
    const s = must(chartFn('slots')(items), isSlots);
    expect(s.slotOf('k0')).toBe('other');
    expect(s.slotOf('k1')).toBe('other');
    expect(s.slotOf('k9')).toBe(8);
    expect(s.groups).toHaveLength(9);
    expect(s.groups.at(-1)).toMatchObject({ slot: 'other', count: 1 });
    const few = must(chartFn('slots')([{ key: 'a', count: 1 }]), isSlots);
    expect(few.groups).toHaveLength(1);
  });
  it('draws axes and SVG marks with classes and slots, never colours', () => {
    const x = must(chartFn('scaleLinear')([0, 10], [0, 100]), isScale);
    const axis = str(chartFn('axisBottom')({ scale: x, y: 50, count: 2 }));
    expect(axis.match(/class="ar-chart-tick"/g)).toHaveLength(3);
    expect(axis).toContain('text-anchor="middle"');
    const svg = str(
      chartFn('svg')({
        width: 10,
        height: 5,
        label: 'L',
        body: chartFn('rect')({ x: 0, y: 0, width: 1, height: 2, slot: 3 }),
      }),
    );
    expect(svg).toBe(
      '<svg viewBox="0 0 10 5" role="img" aria-label="L"><rect class="ar-chart-mark" x="0" y="0" width="1" height="2" data-slot="3"></rect></svg>',
    );
    expect(svg).not.toMatch(/#[0-9a-f]{3,6}|fill="[a-z]/i);
  });
});
