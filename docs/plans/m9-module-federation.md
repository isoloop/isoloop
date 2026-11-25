# M9: Module Federation example (outline)

**Goal:** show that Isoloop works with Module Federation rather than replacing it. Teams keep Module Federation for building and shipping their parts apart, and Isoloop gives those parts a thread of their own, restart and catch-up, and a bus between them.

**Why:** [M3g](m3g-federated-comparison.md) compared Isoloop with a host that loads another team's part by `import()` from its own manifest, with no Module Federation plugin. Most teams that combine parts today use the plugin, so the question they ask, "can I keep my remotes?", has no answer on the site. The README's non-goal, "replacing Module Federation for trusted code sharing", says what Isoloop isn't, not how the two fit together.

**Done when:** a new app in `isoloop/web` has a Module Federation host and two remotes from two "teams", built with the plugin; each remote can be mounted the usual way on the main thread or as an isolate, from the same build, at the flip of a switch; blocking and crashing one remote is measured in both modes on the bench server with the [M3f](m3f-markets-parity.md) method, along with JS bytes, memory and start-up; the results are written up, whatever they show; and the site's "many teams" use and features page link to it.

**Depends on:** 0.1 ([M4](m4-devtools-release.md)), since the app uses the published packages. [ADR 0012](../adr/0012-isolates-built-apart.md) already covers isolates built apart from the host. Needs nothing from [M6](m6-adapters.md) or [M8 Watchers](m8-watchers.md).

**Ships:** as its own app tag in `isoloop/web`, built on `0.2.0` and announced with it if it's ready (the [releases table](roadmap.md#releases)). `0.2.0` doesn't wait for it, and it moves no library version.

Grilled before it gets a task list, and the list comes after the spike.

## Main work items

1. **Spike, with exit criteria:**
   - `loadRemote` from the Module Federation runtime works inside a module worker, with remotes built by the Vite plugin and by Rsbuild. The runtime loads remotes with `<script>` tags by default, which workers don't have; recent releases added support for Web Worker entry points, and the spike checks how far it goes.
   - A remote's exposed module, written with `defineIsolate`, mounts as an isolate through a small bootstrap entry that starts the runtime and loads it.
   - The same remote mounts on the main thread in the host, unchanged.
   - If the first item fails on either bundler, the example ships on the one that works, and the failure is written up.
2. **The host:** nav, layout and the design system on the main thread, as teams have today, with a mode switch per remote.
3. **Two remotes,** one React and one Preact, each stamped with `requires` (ADR 0012).
4. **Talking between remotes:** in main-thread mode through what teams use today (a shared store or custom events); in isolate mode through a topic. Both are shown, so the contract difference is visible.
5. **Stress and crash controls** per remote, and the dashboards' metrics strip.
6. **Measured:** the M3f set, plus JS bytes per mode and the two containment scenarios (a 3 s `block` and a `crash` on one remote): what the other remote and the host lose, and whether and when the crashed remote comes back.
7. **Write-up** next to the app, in the results layout, with the costs reported as plainly as what's contained.
8. **Site:** a "Works with Module Federation" section on the features page and a measured sentence on the "many teams" use; the README's non-goal reworded to link to the example.

## Open risks

- **`shared` singletons don't reach across workers.** Each isolate has its own heap, so a shared React is downloaded once but held once per isolate, and a singleton store shared between remotes doesn't work in isolate mode. The example shows the memory figure rather than hiding it, and the guide says topics replace shared singleton state.
- **A remote has to target the render bridge.** An exposed component written for React DOM doesn't run in a worker unchanged; it has to be written with the adapter. The example's README says so.
- **The runtime's worker support is recent** and may change between releases. The example pins its versions.
