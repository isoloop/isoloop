# Should do

Work we've committed to that waits on something else: a package, a milestone or a decision. When what it waits on lands, the item moves into that milestone's plan and leaves this list.

This list is different from [would-like](would-like.md), which holds ideas that aren't promised. Items here are promised; only their timing depends on something else.

| Item | Waits on | Target milestone | Notes / links |
| --- | --- | --- | --- |
| **`force` for host-owned inputs:** an isolate can set the value of a focused `input`, `textarea` or `select`, e.g. to clear a chat box after sending | The M3 adapters (`@isoloop/react`, `@isoloop/preact`) | M3, after the adapters | Design [§4.6](design/system-design.md#46-eventbridge-and-inputs). A `force` flag on the `prop` record. Nothing is published yet, so this amends `isoloop-dom@1` with a short [ADR 0010](adr/0010-own-render-bridge.md) amendment, without bumping it to `@2`. A vanilla API, `ctx.setValue(node, value, { force: true })`, plus adapter support for controlled inputs. Until then an isolate blurs the input first, as four-loops' D does. |
| **Preact/React smoke test:** both frameworks render a small app into the `isoloop-dom` subset | The M3 adapters, which add the frameworks as devDependencies | M3 | Moved out of [M1 task 5](plans/m1-kernel.md#5-renderbridge-isoloop-dom1-isolate-and-host) so the main repo carries no framework dependency before an adapter needs one. Listed in the [M3 plan](plans/m3-adapters-dashboard.md) adapter items. |
| **`isoloop/examples` repository** for showcase apps such as the markets dashboard | M3 (prerelease publishes); M4's `0.1.0` on npm | M3, installing from npm from M4 | Keeps example-only dependencies out of the main repo and tests the real install path. `examples/four-loops` stays in the main repo, because the E2E and isolation suites run against it. See the [M3 plan](plans/m3-adapters-dashboard.md). |
