# M9: Module Federation example

**Goal:** show that teams can keep Module Federation and add Isoloop one remote at a time. Module Federation stays the way the parts are built and shipped; Isoloop runs the remotes that need it on a thread of their own, restarts them, and gives them a bus. The example is also the showcase for [M8 Watchers](m8-watchers.md): the state the remotes share is read with watchers.

**Why:** [M3g](m3g-federated-comparison.md) compared Isoloop with a host that loads another team's part by `import()` from its own manifest, with no Module Federation plugin, and measured blocking and crashing one team's part. Most teams that combine parts today use the plugin, so the question they ask, "can I keep my remotes?", has no answer on the site.

**Done when:**

- `apps/shop` in `isoloop/web` is a shop built from a host and three Module Federation remotes from three teams, each remote switchable between Module Federation on the main thread and an isolate;
- the remotes share state through watchers in isolate mode, and through a shared store in Module Federation mode;
- isolate mode loads each remote through `src: 'mf:…'` and `@isoloop/federation`, once they ship (decisions 1 to 3), and through the app's own bootstrap until then;
- what's new against M3g is measured on bench machine 1 and written up, whatever it shows (decision 15);
- the architecture diagrams are drawn and checked against the code (decision 20);
- the site's features page, the "many teams" use and the isoloop README link to it.

**Depends on:**

- [M8 Watchers](m8-watchers.md) W1, for `useWatch`, `ctx.bus.watch` and `kernel.watch` ([ADR 0023](../adr/0023-watchers.md), with its 2026-11-26 amendment). The app is built on `0.2.0`.
- An ADR for the `resolveRemote` hook and `@isoloop/federation`, written after the spike (decision 24).
- [ADR 0012](../adr/0012-isolates-built-apart.md) already covers isolates built apart from the host, and [ADR 0015](../adr/0015-visual-pools.md) the portal root an isolate's overlays use.
- The spike needs only `0.1.x`, and starts now.

**Ships:** as its own app tag, `shop-v0.1.0`, in `isoloop/web`, built on `0.2.0` and announced with it if it's ready (the [releases table](roadmap.md#releases)). `0.2.0` doesn't wait for it. The `resolveRemote` hook and `@isoloop/federation` ship in `0.2.0` if their ADR is accepted in time, otherwise in `0.3.0`; the shop ships on its own bootstrap first and moves to `mf:` in a later `shop-v*` tag.

**Status:** grilled 2026-11-26 (Q1–Q25, yes to all after Q1, Q8, Q14 and Q17 were reworded; then Q26–Q31 on the gaps, yes to all). Spike next; the task list comes after it.

## Decisions (2026-11-26, grilled; maintainer)

### Wiring

1. **Both wiring paths are built** (Q1).
   - **(a) The app's bootstrap:** a small entry starts the Module Federation runtime inside the worker and calls `loadRemote`. It needs no library change, and the spike uses it.
   - **(b) The library's hook:** `resolveRemote`, already named in the [system design](../design/system-design.md) §4.2 and not built, resolves `src: 'mf:<remote>/<expose>'` in the loader, so a manifest names a remote in one line.

   The mode switch has two modes, Module Federation on the main thread or isolate. Which wiring isolate mode uses is a build detail: the shop README shows the code for both side by side, and isolate mode moves to `mf:` once the hook ships.
2. **When the hook ships** (Q2): its ADR comes first, after the spike. It ships `@experimental` in `0.2.0` if the ADR is accepted before W1 is done, otherwise in `0.3.0`. The shop doesn't wait for it.
3. **The core gets the hook only** (Q3). The core runtime has no dependency on Module Federation. A new package, `@isoloop/federation`, has the resolver that calls `@module-federation/runtime` inside the worker, behind our own interface with conformance tests. It ships `@experimental` in the same minor as the hook, and its first release follows the steps for a new package in [`isoloop/web` ADR 0004](https://github.com/isoloop/web/blob/main/docs/adr/0004-publishing-and-governance.md) (changeset, npm trust entry, gates). The README's package list gains it (Q23).
4. **Bundlers** (Q4): the host, the product page and the cart are built with the Vite plugin, recommendations with Rsbuild, so two toolchains are tested in one app. If the spike fails on one, every part builds on the other and the failure is written up.
5. **Origins** (Q5): each remote has its own origin (its own port) in dev and in the E2E tests, so CORS and the CSP sources are exercised. Deployed, they live under separate paths of the site's one origin.

### Remotes

6. **Two entries per remote** (Q2 of the first round, Q7): `./X` is the plain component for Module Federation mode, `./X.isolate` wraps the same inner component in `defineIsolate`. No main-thread placement is added to the library.
7. **The shop** (Q8, Q15): one page, with a static generated catalogue of generic products (no real brands):
   - **The host team:** the header with the cart badge, the layout, the design system, the dialog shell, and a headless `catalogue` isolate.
   - **Team A, React, Vite:** the product page (gallery, variant picker, price and stock), `./Product` and `./Product.isolate`.
   - **Team B, Preact, Vite:** the cart drawer, `./Cart` and `./Cart.isolate`.
   - **Team C, React, Rsbuild:** the recommendations rail, `./Recommendations` and `./Recommendations.isolate`.

   No routing, checkout or backend.
8. **The cart modal** (Q16). In Module Federation mode the cart remote renders its own modal, as teams do today. In isolate mode the host owns the dialog shell (backdrop, focus trap, open, close, Escape) and the cart isolate renders the drawer's contents as its surface. Overlays covering the whole page stay a host concern ([ADR 0015](../adr/0015-visual-pools.md), decision 11); popovers inside the drawer use `ctx.portalRoot`. The write-up shows the difference.
9. **The badge** (Q17, Q20, Q21): the host draws it in its header. In isolate mode it reads `cart` with `kernel.watch`, which ADR 0023's amendment adds to W1 with the same signature as `ctx.bus.watch`; in Module Federation mode it reads the shared store. Clicking it opens the dialog shell.
10. **Placement** (Q18): a pool per team, as M3g's `teams` placement: `product`, `cart`, `recs`, and the `catalogue` isolate on its own. No placement switcher.

### Talking between parts

11. **In Module Federation mode** (Q6): a small store we write ourselves, shared as a Module Federation `shared` singleton, which is what teams use today. It also shows that a singleton doesn't reach into an isolate.
12. **In isolate mode** (Q19), four topics:

    | Topic | Published by | Read by | Read with |
    | --- | --- | --- | --- |
    | `cart` (lines keyed by SKU) | the cart isolate | the host's badge, the drawer | `kernel.watch`, `useWatch` |
    | `cart-events` (added, removed) | the cart isolate | recommendations | `subscribe` |
    | `inventory` (price and stock keyed by SKU) | the `catalogue` isolate | the product page, the drawer | `useWatch`, with `keys` on the product page |
    | `add-to-cart` | the product page, recommendations | the cart isolate | `subscribe` |

    `inventory` changes several times a second (a flash sale with stock running down), so values arrive faster than they're painted and watchers have something to skip. Watchers are `@experimental` in `0.2`, and the page says so.

### Controls and modes

13. **The mode switch** (Q9): URL parameters set each remote's mode (`?cart=isolate&recs=main`); changing a toggle reloads the page with them, so no state carries over from the other mode and measurements start clean.
14. **Stress and crash** (Q10): recommendations has a stress dial, synthetic ranking work standing in for scoring on the device. Every remote has `block` (3 s) and `crash` buttons. The dashboards' metrics strip runs across the top.

### Measured

15. **Only what's new against M3g** (Q3 of the first round, Q11). On bench machine 1, Chromium and Firefox, one load level, 5 rounds, with the M3f pairing method, Module Federation mode against isolate mode for all three remotes:
    - JS bytes downloaded
    - memory after GC, which shows a `shared` dependency downloaded once and held once per isolate
    - first render
    - the cost of starting the Module Federation runtime inside a worker
    - messages sent with `useWatch` against `useTopic` on `cart` and `inventory`

    `block` and `crash` on recommendations run once each as a check, and the write-up cites M3g for the full figures.

    **The read switch** (Q26): `?read=watch|topic`, `watch` by default, in isolate mode only. With `topic`, the readers of `cart` and `inventory` use `useTopic`, and the host's badge uses `kernel.subscribe`. It's a knob for measuring, so it isn't in the page's controls; the README and the write-up name it.
16. **Browsers in the E2E tests** (Q24): the smoke and mode-switch specs run on Chromium, Firefox and WebKit. If the Module Federation runtime doesn't load in a WebKit worker, that spec is `test.fail` with a note.

### Security and look

17. **A strict CSP** (Q27). The shop sets a meta CSP from the hosting guide: `default-src 'self'`, `worker-src 'self'`, and `script-src` and `connect-src` listing the remotes' origins in dev (one origin when deployed). If the Module Federation runtime needs more (`'unsafe-eval'`, inline scripts), the spike writes up which source and why, and the shop names that source in its CSP and in the write-up rather than dropping the policy.
18. **The look** (Q30): the site's design tokens, light and dark, so the shop reads as part of isoloop.dev. Product images are generated SVGs (shapes and colours per product), with no photos and nothing from another origin. Generic products (a lamp, a chair, a mug), no brands.

### Where it lives and what it's called

19. **A new app** (Q4 of the first round, Q12): `apps/shop`, next to `apps/basic` and `apps/processor`, tagged `shop-v*` from `shop-v0.1.0`, with a "Shop" tab on `/examples/` and its figures in `example.json`.

### Diagrams, write-up and site

20. **Architecture diagrams with Archify** (Q14, Q22), as plant's:
    - **In `apps/shop/architecture/`:** one diagram per mode (every remote on Module Federation, every remote an isolate), showing threads, pools, the shared store against the bus, and the topics; and a sequence diagram of the bootstrap wiring. Each is a JSON candidate plus its rendered page, both committed, with a drift test that checks the thread and pool counts against the shop's placement. The shop's header links to the diagram of the mode being viewed.
    - **In the library's `docs/diagrams`:** a sequence diagram of `mf:` through `resolveRemote`, next to the How it works diagrams and covered by their drift test. It comes with the hook.
    - The features page's "Works with Module Federation" section links the two mode diagrams and the `mf:` diagram.
21. **The write-up** sits next to the app, in the results layout: findings first, then the tables, then collapsed details. It reports the costs as plainly as what's contained, says which Module Federation features carry over (remotes, versions, `shared` for downloads) and which don't (singleton state, components written for React DOM that aren't ported to an adapter), and has a short section on why the cart and inventory use watchers and the events use `subscribe`.
22. **Site and README** (Q13): a "Works with Module Federation" section on the features page and a measured sentence on the "many teams" use; the isoloop README gains a "Works with Module Federation" line linking to the shop. (The README's old non-goal about Module Federation is no longer there to reword.)

### Announcement

23. **One post for both** (Q31): in the `0.2.0` announcement if the shop is ready by then, otherwise its own post in `isoloop/social` at `shop-v0.1.0`. Written the usual way: three variants and the prose check, mostly what users get, the costs and `@experimental` short and linked. Module Federation and watchers in the same post.

### Order

24. **The order** (Q25):
    1. this plan, the roadmap and the history, to the maintainer; the ADR 0023 amendment for `kernel.watch` in its own PR, as Proposed;
    2. the spike, now, in parallel;
    3. after the spike, the ADR for `resolveRemote` and `@isoloop/federation`, as Proposed;
    4. then the task list.

## The spike

On `0.1.x`, with the app's bootstrap (decision 1a). An Opus fork runs it in its own worktree (Q29), on a throwaway branch in `isoloop/web`, `spike/m9-mf-worker`, pushed for reference and never merged. Its write-up is `docs/plans/m9-spike.md` in this repo (Q28), sent to the maintainer as a PR, so the `resolveRemote` ADR can cite it. The fork doesn't start the ADR or the task list. Exit criteria:

- `loadRemote` from the Module Federation runtime works inside a module worker, with remotes built by the Vite plugin and by Rsbuild, on Chromium, Firefox and WebKit. The runtime loads remotes with `<script>` tags by default, which workers don't have; recent releases added support for Web Worker entry points, and the spike checks how far it goes.
- A remote's `./X.isolate`, written with `defineIsolate`, mounts as an isolate through the bootstrap.
- The same remote's `./X` mounts on the main thread in the host.
- A `shared` dependency (React) is downloaded once across remotes in both modes, and the spike notes what each isolate holds.
- Both modes load under the shop's CSP (decision 17) with no `'unsafe-eval'` and no inline scripts, or the write-up names what more is needed and why.
- What the `resolveRemote` hook would need from the loader is written down for its ADR.
- If the first item fails on a bundler or an engine, the failure is written up and the example ships on what works.

## Open risks

- **`shared` singletons don't reach across workers.** Each isolate has its own heap, so a shared React is downloaded once but held once per isolate, and a singleton store shared between remotes doesn't work in isolate mode. The example shows the memory figure rather than hiding it, and the write-up says topics replace shared singleton state.
- **A remote's isolate entry targets the render bridge.** A component written for React DOM doesn't run in a worker unchanged; `./X.isolate` goes through the adapter. The shop README says so.
- **The runtime's worker support is recent** and may change between releases. The example pins its versions.
- **The showcase rests on `@experimental` APIs:** watchers, `kernel.watch`, and the hook and `@isoloop/federation` once they ship. The page says so, and the versions are pinned.
- **M9 now waits for W1.** If W1 slips, the shop does too; the spike doesn't.
