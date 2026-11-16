# M3h: Auto placement (outline)

**Goal:** a widget spec can say `placement: { "mode": "auto" }`, and Isoloop decides whether the isolate joins an existing pool or gets a worker apart, from measured usage and topic subscriptions, and moves it out later if its pool can't keep up.

**Done when:** an `@experimental` `@isoloop/balancer` package, with its own ADR accepted by the user, places `auto` widgets on the [M3e](m3e-live-widget-creator.md) interactive pages; a test with simulated load shows it separating a heavy widget and keeping light ones together; and a measurement compares it with a naive placement, reported whatever it shows.

**Depends on:** [M3e](m3e-live-widget-creator.md) (the interactive pages are its demo and test bed). Comes before [M3g](README.md) and [M4](m4-devtools-release.md): the per-member load timing it needs changes the public API, which is better done before 0.1. Gets a full task list after its own grilling.

## What's decided (M3e grilling, 2026-11-16)

- **Its own epic and its own ADR,** split from M3e, which ships manual placement only.
- **What auto decides:** join a pool or be separated, from measured usage and from which topics the isolate subscribes to.
- **The spec doesn't change:** M3e's `placement.mode` gains `auto`; `manual` widgets are pinned and never moved.

## Shape to grill

1. **A separate package** on the public kernel API (`isolates()`, `pools()`, `spawn`, `stop`), not a manifest option in `@isoloop/host`, so apps that don't use it don't pay for it.
2. **Placement when an isolate is added:** the best-suited pool, or a new one when none fits, with a worker cap based on `hardwareConcurrency`.
3. **Moving the culprit out:** when a pool stays over budget for a few seconds, its heaviest `auto` member moves apart (stop, then spawn, with state rebuilt from the log), with hysteresis so it doesn't flap, and each move shown on the widget. Packing quiet isolates back into pools is a later question.

## Facts to establish first

- **Per-member load doesn't exist.** The heartbeat reports `lagMs` per worker; a member's idle report has only `sinceDeliveryMs`, `inFlight` and `holds`. Finding the heavy member of a pool needs the runtime to time each member's handlers, frames and deliveries, which changes the runtime and the protocol.
- **Whether topic affinity pays:** grouping isolates by subscription only saves work if a pool gets a record once per worker rather than once per member. Check against [ADR 0016](../adr/0016-fewer-messages-per-record.md) and measure before a policy relies on it.

## Open risks

- A move restarts the widget: visual isolates may flash, and state rebuilt from the log is limited by retention.
- Load signals in a browser are noisy, and a policy tuned on one machine may flap on another.
