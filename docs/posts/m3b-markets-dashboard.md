# A backend-less markets dashboard on Isoloop

*M3b write-up, 2026-11-07*

M3b's promise: **the flagship dashboard, backend-less on a static host, at the flip of a toggle against the same app built the ordinary way, with the numbers recorded.** The dashboard lives in its own repository, [`isoloop/examples`](https://github.com/isoloop/examples/tree/main/apps/dashboards/markets), and installs `@isoloop/*` from npm like any app would.

## What it is

Public exchange feeds (Coinbase, Kraken, Bitstamp and OKX over WebSockets, or a synthesized recording at N× by default), a cross-market aggregator (VWAP, spreads and volume per symbol), alert rules evaluated in the tab, three canvas charts, a virtualized trades table of 20,000 rows, an alerts panel with a rule editor, and stress controls on every widget: block (a 3 s busy loop), crash and flood. No server: every byte of logic runs in the visitor's tab.

## One source, five builds

The comparison is only fair if the code is the same. So the logic (`src/core/`), the chart drawing (`src/charts/`), the widgets and the page shell are written once, with no Isoloop imports. Two small switches, chosen per build by a Vite alias, are all that differ:
- `slot.native.tsx` renders a widget straight into the tree; `slot.isoloop.tsx` gives the host a surface to mount the widget's isolate into.
- `data.native.ts` backs `useStream`, `useLatest` and `usePublish` with a plain store; `data.isoloop.ts` with topics.

That gives `/native` and `/isoloop` in React, the same pair in Preact (React aliased to `preact/compat`), and `/mixed`, an Isoloop page with React charts and Preact filters and alerts side by side. The Preact widgets there are built apart and loaded by URL, the way ADR 0012 lets a host load isolates someone else ships. A build check fails CI if a native bundle contains any Isoloop code, or a Preact bundle any React DOM.

Native gets the defences a normal app would have, and no more: a store, error boundaries per widget, `localStorage` for alert rules, and no hand-written workers.

## The numbers

Recorded by the Comparison workflow on a 4-core CI runner, Chromium ([method and video](https://github.com/isoloop/examples/tree/main/apps/dashboards/markets/comparison)):

| Build | Typing, calm (median) | Typing, one chart blocked (median) | (worst) | fps after | Long tasks (10 s) | First data | JS, gzipped |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native · React | 11 ms | 2832 ms | 2844 ms | 27 | 3 | 168 ms | 100 KB |
| Isoloop · React | 34 ms | 42 ms | 58 ms | 61 | 0 | 357 ms | 153 KB |
| Native · Preact | 13 ms | 2832 ms | 2847 ms | 4 | 3 | 103 ms | 41 KB |
| Isoloop · Preact | 35 ms | 40 ms | 86 ms | 61 | 0 | 277 ms | 94 KB |

- **With one chart blocked**, native typing waits the busy loop out, about 2.8 s per keystroke, and the frame rate collapses. On Isoloop the chart's loop is its own: the alerts panel answers in 40 to 90 ms and the page holds 60 fps.
- **The costs are real and on the same table.** Typing takes about 25 ms more when nothing is blocked, because the input travels to the isolate and the render comes back. First data takes about twice as long. Isoloop adds about 50 KB of gzipped JavaScript.

## Bugs the dashboard found

- **A controlled checkbox could stay drawn as checked** after its state came back unchecked from a topic. One click fires `click`, `input` and `change` with the same state, and the later two overwrote what React had restored in the worker, so the next render looked like a no-op. The host now reports a checkbox's state only when the worker doesn't know it yet (#127).
- **Scroll events didn't reach isolates** with the element's offsets, which a virtualized table needs (#125).
- **`@isoloop/vite` didn't publish the file its exports named** (#123); CI now checks published exports.

## What M3b didn't do

- **The memory metric** needs COOP/COEP headers, which GitHub Pages can't set, so it shows "unavailable" on the public deploy.
- **WebKit on CI runners** sits close to the 200 ms input budget under load: some runs measure 230 to 240 ms for Isoloop typing with a chart blocked or the bus flooded. Locally, and in most CI runs, it stays under.
- **Tabs don't share feeds:** each tab opens its own WebSockets ([would-like](../would-like.md)).

## Next

The public deploy ships with the first `markets-v*` tag. Then M4: devtools, the docs site and 0.1.
