# Core diagrams

How the Isoloop runtime is put together, for a developer evaluating it. Each diagram is an [Archify](https://github.com/tt-a1i/archify) candidate (`<name>.json`) and its rendered page (`<name>.html`). Both are committed, so nothing here needs Archify to build or view. The site (`isoloop/web`, ADR 0002, decision 6) fetches this folder at a sha on `main` and shows the pages on its "how it works" page.

They were drawn from the code at `f825ffb` (`meta.repository.revision` in each JSON, which the cited sources link to).

| Order | File | What it shows |
| --- | --- | --- |
| 1 | `runtime-topology` | Main thread, an own worker, a pool worker and the bus worker, and what talks to what |
| 2 | `placement` | The same three isolates in three own workers or in one pool, and what a pool saves and shares |
| 3 | `bus-publish` | A record through the bus: grants and size, schema, duplicates, the log, delivery and commits |
| 4 | `isolate-lifecycle` | The supervisor's states and transitions, with the default timings |
| 5 | `restart-own-worker` | An own worker crashes, restarts and replays from its committed offset |
| 6 | `restart-pool` | A member restarts alone after its own error, or the whole pool restarts after a worker failure |
| 7 | `bus-crash-reattach` | The bus worker crashes, a new one starts, and the isolates reattach |

Each page takes `?theme=light|dark`, which wins over the viewer's saved choice and the system setting.

## Keeping them true

`diagrams.test.ts` runs with the unit tests (`pnpm test:node`, project `diagrams`). It checks what the code can confirm:

- **Lifecycle states:** the lifecycle diagram's states are exactly the supervisor's `IsolateState`. The list in the test is a `Record<IsolateState, true>`, so `tsc` fails if a state is added or removed in the code without updating it.
- **Timings and limits:** the lifecycle and pool-restart labels match `DEFAULT_SUPERVISOR_CONFIG` (blocked after, killed after, restarts within the window). The bus diagram's commit label matches `DEFAULT_COMMIT_INTERVAL_MS`.
- **Placement:** the field the placement diagram names is the manifest's `pool`. In the placement and topology diagrams, a pool region is one thread, an own-worker region has one thread per isolate, and each region's isolate count matches its cards.
- **Sources:** every file any diagram cites still exists.

It doesn't check layout, wording or arrows. When the code changes what a diagram shows, redraw it and update `meta.repository.revision` and the cited lines.

## Re-rendering

Archify isn't part of this repo's toolchain. To re-render after editing a JSON:

1. Install the Archify skill or CLI.
2. From the repo root, for each changed diagram, run:

   ```bash
   node <archify>/bin/archify.mjs finalize <type> docs/diagrams/<name>.json docs/diagrams/<name>.html \
     --repo-root . --quality showcase
   ```

   `<type>` is the JSON's `diagram_type`. If no Chrome is found, set `ARCHIFY_CHROME` to a Chromium executable, for example Playwright's.
3. Run `node docs/diagrams/externalize.mjs`. It moves each page's inline scripts and styles into the shared `viewer-<hash>.js` and `.css` files, so the pages run under `script-src 'self'` and `style-src 'self'` (the [hosting guide](../guide/hosting.md)'s policy), and deletes viewer files no page uses any more.
4. Delete the `*.delivery.json`, `*.finalize*.json`, `*.browser-check.json` and review files Archify writes next to each page. They aren't committed.

## What the pages still need from a policy

Archify also writes per-node `style="--step:N"` attributes (the reveal animation's order) and embeds its fonts as `data:` URLs. Under `style-src 'self'` the animation plays without its stagger; under a `font-src` without `data:` the text falls back to system fonts. The diagrams read correctly either way.
