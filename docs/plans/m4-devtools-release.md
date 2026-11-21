# M4: Devtools, agents and the 0.1 release (initiative)

**Goal:** the first npm release, with what a developer needs around the library on day one: a devtools panel that runs as an isolate, a way for agents to learn Isoloop and to see and call into a running app, and a docs site.

**Done when** (RFC 0001): `0.1.0` is published with a launch post, and each epic below has met its own done-when.

**Status (2026-11-19):** M4a's tasks 1–11 and 13 and all of M4b (tasks 1–11; task 12 droppable) are done, on `0.1.0-next.5`; M4c is next, then M4d. *2026-11-20:* M4c was grilled into a full plan, and its phase A starts before the freeze. Left in M4a: the skill (after the freeze) and the real-agent run with its write-up. The two fixes 0.1 waited for are in: the commit loss (#211, in `0.1.0-next.3`) and the stop-then-spawn race (#219). *2026-11-21:* the API is frozen (`0.1.0-next.9`), and M4c's done-when is met: the docs and the API reference are live on isoloop.dev (`site-v0.6.0`, on `0.1.0-next.10`). Left: M4a's skill (task 12, unblocked by the freeze) and real-agent run (task 14), M4c's search, skill link and write-up, and M4d's release pipeline, launch post and `0.1.0`, which wait for the maintainer's landing-page pass. *2026-11-21, later:* M4e (the source layout) was added in a grilling, and `0.1.0` waits for it too.

Comes after [M3e](m3e-live-widget-creator.md), [M3h](m3h-auto-placement.md), [M3i](m3i-balancer-scaling.md) and [M3g](m3g-federated-comparison.md) ([M3](m3-adapters-dashboard.md) and [M2b](m2b-durable-log.md) are done). 0.1 also waits for two bus and kernel fixes decided on 2026-11-17: the consumer-group commit loss ([#211](https://github.com/isoloop/isoloop/issues/211), [ADR 0016](../adr/0016-fewer-messages-per-record.md)'s amendment) and the stop-then-spawn race on one isolate id. The `0.0.0-next` prerelease workflow from [M3b](m3b-dashboard.md) task 1 is replaced by the Changesets pipeline in M4d.

**Changed 2026-11-17:** M4 became an initiative of four epics, in a grilling that also brought agent support into 0.1 ([investigation](../investigations/ai-enablers.md)). Until then M4 was one outline with the dev MCP as its last, droppable item, and [M7](m7-webmcp-stable.md) was a WebMCP spike after M6.

**Changed 2026-11-21:** M4e was added in a grilling, before `0.1.0`. It lays out each package's `src/` under [ADR 0021](../adr/0021-source-layout-and-entry-points.md), adds the checks that keep it that way, and adds a bundle-size guide.

## Epics

| Epic | Plan | What | Done when |
| --- | --- | --- | --- |
| M4a Agents | [m4a-agents.md](m4a-agents.md) | Tools on contracts (ADR 0018), `kernel.request`, the `isoloop` CLI, the dev MCP, `@isoloop/webmcp`, `AGENTS.md`, the "build with Isoloop" skill | Agents can learn Isoloop from isoloop.dev and the skill, and can list and call the markets tools through the dev MCP and through WebMCP, with block, crash and `failed` behaving as decided; the cost per call is measured |
| M4b Devtools | [m4b-devtools.md](m4b-devtools.md) | `kernel.inspect()` and the `inspect` grant (their own ADR), then the panel drawn by an isolate | The panel shows isolates, the bus and a live log on plant and markets, and keeps working while the bus restarts |
| M4c Docs | [m4c-docs.md](m4c-docs.md) | The docs site in `isoloop/web`, the guides, the API reference, `llms.txt` | The docs are live on isoloop.dev with `llms.txt`, `llms-full.txt` and a Markdown copy of each page |
| M4d 0.1 release | [m4d-release.md](m4d-release.md) | API review and freeze, changesets, the release pipeline, the launch post | `0.1.0` on npm with provenance, and the launch post is out |
| M4e Source layout | [m4e-source-layout.md](m4e-source-layout.md) | Areas in every package's `src/` (ADR 0021), explicit entry lists, the layout test and lint rules, the bundle guard, the bundle-size guide | Every package follows ADR 0021 with no `pending` list, its checks run in CI, and `0.1.0-next.11` is on npm with the bundle-size guide in the site's docs |

## Order

```mermaid
flowchart LR
  M4a1["M4a tool surface<br/>(ADR 0018)"] --> M4a2["M4a dev MCP,<br/>@isoloop/webmcp"]
  M4b1["M4b inspect feed<br/>(its ADR)"] --> M4b2["M4b panel"]
  M4b1 --> M4a2
  M4a2 & M4b2 --> M4d1["M4d API freeze"]
  M4d1 --> M4c["M4c API reference,<br/>llms.txt"]
  M4d1 --> M4a3["M4a skill"]
  M4c & M4a3 --> M4d2["M4d release,<br/>launch post"]
  M4d1 --> M4e["M4e source layout,<br/>bundle guard"] --> M4d2
```

- M4a's tool surface and M4b's inspection feed run in parallel. The dev MCP's inspection reads wait for M4b's feed.
- The API freeze (M4d task 1) comes once M4a and M4b's public API is merged, and before M4c's API reference and before M4a's skill is finished.
- M4c's phase A (the site's docs section, the docs pipeline and the guides) doesn't wait for the freeze; its fence check makes the freeze's renames visible in the guides. Phase B (the TSDoc pass, the API and CLI reference, search) follows the freeze ([M4c](m4c-docs.md), decision 1, grilled 2026-11-20).
- The freeze starts on the maintainer's word.
- M4e comes after the freeze and runs beside the maintainer's landing-page pass. Its moves change nothing the API check reports, and `0.1.0` waits for it.

## Droppable if 0.1 slips

In this order: topic replay (M4b), then `@isoloop/webmcp` (M4a), then the skill (M4a). Firm: `llms.txt`, `AGENTS.md`, tools on contracts with `kernel.request`, the dev MCP, the panel's isolates and bus views and its live log.

## Open risks

- Scope creep in devtools; ship the two panels and the log first.
- Docs time is easy to underestimate; start the "limits" page early.
- WebMCP is still a Community Group draft, behind a flag in Chromium and behind prefs in Firefox (both supported since 2026-11-19, ADR 0018's amendment); `@isoloop/webmcp` is `@experimental` and in its own package so a change there doesn't touch the other packages.
