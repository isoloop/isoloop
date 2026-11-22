# A coding agent on the markets dashboard

*M4a write-up, 2026-11-22*

M4a's promise: **agents can learn Isoloop, see a running app, and call the tools an app exposes.** This is the record of one run of each part that needs a real agent: Claude Code on the markets dashboard through the dev MCP, and Claude Code writing three small apps with the "build with Isoloop" skill. It includes what went wrong.

## What an agent gets

- **To learn Isoloop:** `llms.txt` and a Markdown copy of each docs page on isoloop.dev, a snippet for your app's `AGENTS.md` in [getting started](../guide/getting-started.md), and the skill ([#374](https://github.com/isoloop/isoloop/pull/374), in review when this was written).
- **To see a running app:** the dev MCP (`isoloop mcp`). It reads the page's isolates, topics, records and events. With `--allow-write` it can also restart, kill, block, publish and request.
- **To call the app:** a topic with a `reply` schema and a `tool` description, listed in `agents.expose`. The dev MCP forwards it in development, and `connectWebMCP` lists it to a browser's agent ([Agents guide](../guide/agents.md)).

Markets exposes two tools: `markets.quote.v1`, which reads, and `markets.alerts.create.v1`, which adds an alert rule.

## The run on markets

- **App:** markets 0.9.0 ([`66cf1f7`](https://github.com/isoloop/web/tree/66cf1f7/apps/dashboards/markets)) under Vite's dev server, `?size=normal&seed=1`: 22 isolates, each on its own worker, on the seeded replay.
- **Library and CLI:** `@isoloop/*` and `isoloop` at `0.1.0-next.11`, from npm.
- **Agent:** Claude Code 2.1.330, `claude -p`, model `claude-sonnet-5-5`. Its only tools were this MCP server's, all allowed in advance, writes included in the third prompt. It had no user settings, no memory and an empty working directory.
- **Machine:** a 16-core desktop, Linux under WSL2, headless Chromium 158, 2026-11-22.
- **Method:** three prompts, with their pass criteria written down first. One attempt each, each with a fresh agent, CLI and page. A script held each prompt back until the page had paired, and logged the kernel's own isolate states, heartbeats, prices and rules every 500 ms. The answers were checked against that log and against what each tool returned.

The criteria, as written before the first prompt:

1. **Nothing induced:** "says none is meaningfully lagging, or names one only with figures the ground truth has."
2. **A blocked widget:** "names `volatility` and no other isolate as the one lagging."
3. **The alert:** "exactly one new rule BTC-USD / price / above / X, in the panel and on alert-rules.v1, the request has via 'mcp', and no other write tool was called."

| Prompt | Set-up | Tool calls | Answered in (Claude Code's clock) | Result |
| --- | --- | --- | --- | --- |
| "Which isolate is lagging?" | nothing induced | `isoloop_isolates` | 3.8 s | Pass, with one small misstatement |
| "Which isolate is lagging?" | one widget blocked on purpose | `isoloop_isolates` | 3.5 s | Pass, with two misstatements |
| "Create an alert for BTC above 99970." | `--allow-write` | `markets.alerts.create.v1` | 1.9 s | Pass. The rule then fired repeatedly, a bug in markets |

Claude Code replaces the dots in tool names: the agent saw `markets_alerts_create_v1` for `markets.alerts.create.v1`, and the call arrived on the right topic.

### Nothing lagging

The agent made one call and answered:

> No isolate is meaningfully lagging. All 22 are `running`, with 0 restarts and 0 dropped messages.
>
> The highest heartbeat lag is on **`replay`** at about 4.4 ms. That's negligible. Every other isolate is at 0–0.1 ms.

That matches the tool's result and the log, where no isolate left `running` or lagged more than 6.9 ms in the whole run. It went on to say that two widgets with one queued update each had "applied more than 940 updates": one had 948, the other exactly 940.

### A blocked widget

To give the question an answer, the script clicked the `volatility` widget's own stress button, a 3 s busy loop, about every 4 s (one gap was 5.6 s), starting 11.6 s before the prompt. The prompt didn't name the widget. The agent made one call and answered:

> Only one isolate is off: **`volatility`**.
>
> - Its state is `blocked`.
> - Its last heartbeat was 3058 ms ago. Every other isolate beat within about 90 ms.
> - Its `lagMs` reads 0, which is stale. It comes from the last beat and says nothing about the current state.
> - It has 0 restarts and 0 dropped, and its surface queue is empty (6 frames applied).
>
> The other 22 isolates are `running`. The largest `lagMs` among them is `replay` at about 4 ms, which is normal.

- **Right:** the isolate, its state and the stale figure. `volatility` was the only isolate that blocked, and it never restarted.
- **Wrong:** the other isolates were 21, not 22, and the 6 it read as frames are applied batches.
- **`lagMs` alone would have misled it.** While an isolate is blocked, `lagMs` still holds its last beat's value, here 0. `state` and `sinceBeatMs` show the block. The lag, about 3,000 ms, appears on the first beat after the block ends, by which time the isolate is `running` again.
- **One snapshot was partly luck.** The call landed at the end of a block. Between blocks the widget read `running` for about 1.5 s at a time, and once for 3.2 s: a call there could have missed it. The agent didn't look at `isoloop_events`, though it offered to.
- **Subscription lag didn't show it:** it read 0 for every subscription in every sample of this run.

### Creating an alert

The script read the highest BTC-USD price on the page, 99,769.53, added 0.2%, and rounded up. The agent mapped "BTC" to `BTC-USD`, chose the `price` metric and made one call:

```json
{ "symbol": "BTC-USD", "metric": "price", "op": "above", "threshold": 99970 }
```

> I created the alert: BTC-USD price above 99,970. Its id is `agent-h8`.

The page had that one rule in its panel and on `alert-rules.v1`, and the request's record said `via: 'mcp'`. The agent called none of the other write tools, though it was allowed to.

About 9 s after the prompt the price passed the threshold, and **the rule fired 12 times in 14 seconds.** That's a bug in markets, not in the agent's call. The dashboard checks each exchange's price in turn against one state per rule, so while exchanges are on both sides of the threshold, the rule re-arms and fires again. Run on its own with two fixed prices either side of a threshold, the alert engine fired 10 times in 10 rounds. It's tracked in [isoloop/web#255](https://github.com/isoloop/web/issues/255). The agent had ended its turn and didn't see it. The tool's description doesn't say that a price rule watches every exchange.

### What failed in the harness

The first probe, before any prompt, didn't start: the dev server couldn't load its config, because only part of the web workspace was installed. With the whole workspace installed, a second probe paired and sent no prompt. The three runs followed, and none was repeated.

## The skill, tried on three prompts

Each prompt asked for a small app in one framework: a widget isolate that subscribes to a topic and draws it, a button that publishes, a button that restarts the widget with its data back, and a Playwright test. Each ran in a fresh project with the packages installed from the branch and the skill installed by `isoloop skill add`. The agent (the same Claude Code and model) could read and write files in that project and had no shell, so it never ran its code. An answer passed if it type-checked, built, passed its own test and passed an independent test written before the first attempt. No answer was edited.

Round 2, on the skill at [`e840935`](https://github.com/isoloop/isoloop/blob/e840935a7a5a27a63f587bfdd892c6d78009f893/skills/build-with-isoloop/SKILL.md), 2026-11-22:

| Prompt | It draws | Type check | Build | Its own test | Independent test | Time |
| --- | --- | --- | --- | --- | --- | --- |
| Plain DOM | the latest temperature | pass | pass | pass | pass | 34.8 s |
| React | the latest price of every symbol | pass | pass | pass | pass | 35.5 s |
| Preact | progress, in two components | pass | pass | pass | pass | 44.6 s |

- **An earlier round,** on `baf79e0`, passed all three too. The skill changed afterwards because a check against the source found three overstatements, so all three ran again.
- **The independent tests can fail:** two broken copies of round 1's answers failed them, one without its subscribe grant, one with two `useTopic` calls on the same topic in one isolate. The second fails without an error, because the later subscription replaces the first.
- **What this doesn't show:** what the skill adds. There was no run without it, the prompts are small and new-project only, and it's one model, one agent and Chromium only. Tools for agents, pools, the balancer and porting existing code weren't covered.

## What a call costs

Measured on 2026-11-19 on plant, a topic with a handler that does nothing, at `0.1.0-next.5`, on a dedicated 8-core bench machine with four cores pinned at 2.0 GHz, Playwright 1.65 (Chromium 158, Firefox 159). One call in flight, median of 5 rounds with the lowest and highest ([the investigation](../investigations/agent-call-cost.md)):

| Figure | Chromium, idle | Chromium, 5 kHz | Firefox, idle | Firefox, 5 kHz |
| --- | --- | --- | --- | --- |
| Round trip, mean (ms) | 0.15 (0.15 to 0.15) | 0.24 (0.24 to 0.27) | 0.60 (0.60 to 0.61) | 1.48 (1.36 to 1.58) |
| Round trip, p95 (ms) | 0.3 (0.3 to 0.3) | 0.4 (0.4 to 0.4) | 1 (1 to 1) | 6 (5 to 7) |
| Main thread per call (ms) | 0.035 (0.034 to 0.035) | 0.059 (0.050 to 0.084) | not measured | not measured |

That is the cost of `kernel.request` alone. The transport's hop, the tool's own work and the agent's time come on top. For scale, the answers above took 1.9 to 3.8 s by Claude Code's own clock, nearly all of it outside the page. There's no native baseline, because native has no bus.

### The burst it found, and the fix

The same measurement found that 1,000 calls issued at once didn't complete on a topic keeping 100 records: a caller waited out its 10 s timeout ([#288](https://github.com/isoloop/isoloop/issues/288)). A bus test confirmed the cause. Requests are records, so retention removed the older ones before the answering isolate read them, and 100 of the 1,000 were answered. [#303](https://github.com/isoloop/isoloop/pull/303) fixed the waiting in `0.1.0-next.7`: a request dropped that way now fails at once with `dropped`. The limit itself remains: a topic keeping 100 records still answers 100 of such a burst, so size a tool's retention for its largest burst.

## What wasn't tested

- **WebMCP with a real agent.** None was available to this run. WebMCP is behind a flag in Chromium and in Firefox. Our end-to-end tests call the tools through Playwright in both, which is not an agent choosing to call them.
- **Whether an agent asks before it writes.** The write tool was allowed in advance. The tool is marked consequential, and confirming with the user is the agent's job.
- **Other agents and models,** more than one attempt per prompt, a person driving an interactive session, several open tabs, and a tool answering while its isolate crashes under a real agent.
- **Whether the rule survives a reload** in this run.
