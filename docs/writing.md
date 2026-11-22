# Writing the docs

These rules apply to the guides in [`docs/guide`](guide/), the TSDoc that the API reference is generated from, the package READMEs, the changesets, the "build with Isoloop" skill, and the `AGENTS.md` snippet in getting started. They're decided in [M4c](plans/m4c-docs.md), decisions 9, 19, 20 and 30. Rules marked **(checked)** fail `pnpm docs:check`. The steward reviews the rest on each PR.

## Voice

- **Plain English, short sentences.** One idea per sentence. Prefer the everyday word: "use", not "utilise"; "for example", not "e.g.".
- **How it works and how to use it, not why it was decided.** Guides and public TSDoc don't link or name ADRs or plans, give decision numbers, or carry "amended" notes: the decisions live in the repo for contributors. A reason the reader needs in order to use a feature stays, as a plain sentence ("workers have no `localStorage`, so the panel keeps its state in IndexedDB"). Links to the bench results behind a figure stay. **(checked)**
- **Say what the code does, as it is today.** Check each claim against the implementation before writing it. Don't write about plans ("later", "soon", "in a future version"). Plans live in [`docs/plans`](plans/README.md).
- **Address the reader as "you"** in guides, and write in the present tense.
- **Contractions are fine** ("it's", "doesn't").
- **British spelling:** behaviour, colour, sanitise, licence (the noun). Identifiers keep their own spelling (`color` in CSS).
- **No em dashes.** Use a colon, a comma, brackets or a new sentence. **(checked)**
- **Measurements, not adjectives.** Every performance figure names the device or machine, the build, the version or tag, and the date, and links the bench or results it came from: "71–86% less memory (20 headless isolates, [bench/pools](../bench/pools/README.md), 2026-11-08)". Give results in both directions, including the cases where native does as well or better.
- **Devices are generic.** Describe a device by its class, its platform and the specs that matter ("a mid-range Android phone, 8 cores, 8 GB, Firefox 156"; "an older iOS phone, Safari 16.6"), never by brand, model or chip.
- **Isoloop is never "faster than native".** Isoloop is a toolchain: containment, restart and catch-up, a bus with retention and replay, placement as a switch. Say what it gives, and say plainly what it costs in CPU, memory and start-up time.

### Banned phrases (checked)

`simply`, `just`, `easily`, `obviously`, `of course`, `blazing`, `seamless`, `seamlessly`, `effortless`, `magic`, `faster than native`.

The check matches whole words, ignoring case, outside code. If a sentence needs one of them, rewrite the sentence: `just as` becomes `as`, and `simply call` becomes `call`.

## Formatting

- **Bold lead-ins on bullets.** A label ends with a colon (**`workers.bus`:** the bus worker bundle). A short sentence ends with a full stop (**An event loop.** A member that runs…).
- **Bold a term where it's defined,** once: "A **pool** puts several isolates in one worker".
- **Code in backticks:** names from the API, options, error codes (`bus_unavailable`), topics, file paths, commands.
- **Headings in sentence case.** h2 for sections and h3 inside them, no deeper.
- **Dates as `YYYY-MM-DD`.**
- **Tables** for options and for comparisons with more than two columns. Lists for anything else.

## A guide's shape

Every guide in `docs/guide` follows this skeleton. **(checked)**

```md
# Title

One sentence: what this page covers and who it's for.

## When to use it

## …the body, in the order a reader does the task…

## Limits

## See also
```

- **The title is the `# h1`,** and the only h1. There's no front matter.
- **The lead is the first paragraph:** one sentence of at most 200 characters. The site uses it as the page's description, in `llms.txt` and in link previews. **(checked)**
- **`## When to use it`** says when the page's feature fits and when it doesn't, and which page to read instead.
- **`## Limits`** lists what the feature doesn't do or can't hide. A limit that applies to Isoloop as a whole also goes in "What Isoloop can't hide".
- **`## See also`** links related guides. The API reference links each symbol to its guides on its own (from `docs/guide/map.json`), so the guides don't link the reference symbol by symbol.

The API reference (`docs/api/`) is generated from TSDoc, so it's never edited by hand.

## Package READMEs

A package's `README.md` is what npm shows, so it says what the package is and sends the reader to the guide. It holds four things, in this order:

1. **A lead sentence:** what the package is, and `@experimental` or **Internal** when it is. A public package may follow it with a short "What you get" list.
2. **The install command.**
3. **One snippet:** the smallest call that uses it.
4. **Links to its guide and its API page.**

Limits, defaults, options and behaviour live in the guide, not the README, so there is one place to keep current. Like the guides, a README doesn't link or name ADRs or plans. An internal package with no guide lists its entry points instead of the snippet and the link; its README is for contributors, so it may name the ADRs behind it.

## Code blocks

- **Give each fence a language:** `ts`, `tsx`, `sh`, `json` or `html`.
- **`ts` and `tsx` fences type-check** against the workspace packages. **(checked)** Write them as code that compiles: imports at the top, real names, real options.
- **A fragment that can't compile on its own** (a single option, a line from a larger file) is marked ` ```ts nocheck `. Use it rarely: each one is a place where a rename goes unnoticed.
- **Keep examples small.** Show the call and what it returns, not a whole app. The examples in [`isoloop/web`](https://github.com/isoloop/web) are the whole apps; link one at a fixed sha.

## Links

- **Between guides:** relative links (`[pools](pools.md)`). The site turns them into `/docs/…` URLs.
- **To benches, results and source:** relative links too (`[bench/pools](../bench/pools/README.md)`). On GitHub they work as they are. The site makes them GitHub links at the version it was built from. An investigation is linked only when it backs a figure.
- **Not to ADRs or plans.** They record why something was decided; a guide says how it works. **(checked)**
- **To `isoloop/web`:** a GitHub link at a fixed sha, so the code it points at can't move.
- **Every relative link resolves.** **(checked)**

## TSDoc

The API reference is generated from the TSDoc of the published `.d.ts`, so TSDoc is docs and follows the voice rules above. `docs:check` reads each public declaration once, where it's declared (`@internal` ones and the internal entries left out), and fails on the items marked **(checked)**. The steward reviews the rest.

1. **Every exported function, class and const** has a lead sentence, `@param` for each parameter, `@returns` when it returns something, and `@throws` naming its error codes (`not_exposable`, `no_responder`, …). The lead, and `@param` and `@returns` on functions and on consts you call, are **(checked)**. `@throws` and a class constructor's `@param`s are the steward's, since the `.d.ts` doesn't show what a function throws.
2. **Every field of an exported options or config type** (`KernelConfig`, a topic's options, `connectDevtools`' options) has its own comment, with its default. A type whose name ends in `Options` or `Config` counts. The comment is **(checked)**; the default is the steward's.
3. **`@example` on the main entry points:** `createKernel`, `defineIsolate` (react, preact, dom), `topic`, `contracts`, `isoloop()`, `kernel.request`, `connectDevtools`, `connectWebMCP` and `createBalancer`. Put the code in a ` ```ts ` fence. Examples are type-checked like the guides' fences, next to the same example app. **(checked)**
4. **`@experimental`** on anything that may change before 1.0. The site marks it with the Experimental pill.
5. **`@internal`** keeps a declaration out of the API check and the reference. Use it for exports that exist only for other `@isoloop/*` packages.
6. **No `@see` to guides.** The reference gets those links from `docs/guide/map.json`.
7. **No ADRs or plans,** as in the guides: no links to them, no `ADR 0001`, no milestone (`M3h`), no decision numbers. A `//` comment in the code may name them for contributors. **(checked)**
