# Isoloop Builder (decisions so far)

The Builder is planned in its own repository, `isoloop/builder`, created when the Builder starts. Until then this note holds what was decided in a grilling on 2026-11-16. It moves to that repo, with the Builder ideas in [would-like](../would-like.md#isoloop-builder), and leaves this one.

**Goal:** a non-technical person brings their data and asks an agent for a dashboard or a screen, and gets it without writing code.

**Done when** (v1): an E2E test with recorded agent responses goes from an empty Builder app and a CSV file to a three-widget dashboard, accepted and saved; and one real run by a non-technical person, starting from nothing, is recorded and written up, whatever it shows.

**Depends on:** the library only; not on [M3e](m3e-live-widget-creator.md). M3e's interactive mode is a developer's page whose users can only consume the topics of an existing dashboard; the Builder lets a non-technical person define a whole page, its sources and topics included, and combine them, so it's a separate app with its own format (clarified by the maintainer, 2026-11-16). When it starts is to be decided; it runs on `next` prereleases and its first release waits for `0.1.0`.

## Decisions

1. **A standalone Builder app,** an Isoloop host app the Builder ships: the user brings data and the agent adds widgets. Extending an app someone already has is the developer case, in [would-like](../would-like.md#getting-started).
2. **The agent writes specs only, never code,** in v1: the Builder's own page format (sources, topics, widgets and layout). A non-technical user can't review code, but a spec is validated, safe and easy to undo. Generated code in a sandbox is in would-like.
3. **Data sources:** a CSV or JSON upload and a JSON URL polled at an interval, each run as a headless isolate publishing to a topic; WebSocket sources come later. The Builder adds no runtime of its own. Two questions come with them (found in the M3e grilling, 2026-11-16, which left these sources out):
   - **Uploads** need the host to attach the chosen `File`s to a forwarded `change` event, a change to `isoloop-dom@1` events that needs an ADR.
   - **Network:** there's no `fetch` grant, and a grant that wraps `fetch` in a worker can be bypassed, so the page's CSP `connect-src` is the real limit; decision 5's "`fetch` grant to the Claude API only" needs its own ADR.
4. **Where the user talks to the agent,** in two steps:
   - **First, a chat panel in the app,** calling the Claude API with the user's own key, kept in browser storage. No backend.
   - **Later, Claude Desktop,** with a one-click MCP extension that drives the app, using the person's Claude subscription. It gets its own MCP bridge on the dev MCP's transport code; M4's dev MCP stays dev-only, so publishing and restarting from outside the tab are never possible in a production app by accident.
   - WebMCP ([M7](m7-webmcp-spike.md)) could later let browser agents drive the app directly.
5. **The agent loop runs in its own headless isolate,** with a `fetch` grant to the Claude API only, and publishes specs to the spec topic. If it hangs or crashes, the dashboard keeps running and the agent restarts. The key never goes into a topic or an export file.
6. **Claude first, behind our own `Agent` interface** with conformance tests; other providers only if users ask.
7. **Change sets, previewed and accepted.** The agent can add, edit and remove widgets and sources and change the layout. Each answer is a change set the user previews and accepts, and each accepted one is a record in a persistent topic, so undo is going back one record.
8. **Saved in the browser:** a persistent topic in OPFS, with export and import as a file. No accounts or backend; an online platform to store and view dashboards is in would-like.

## Ideas to grill when the Builder starts (2026-11-16)

Raised by the maintainer; not decided yet.

- **The Builder ships an application that runs locally,** not only a dashboard inside the Builder.
- **Our own components as templates:** a set of ready widgets, and the user describes what they want.
- **Drag and drop** to create and place widgets, next to the agent. ADR 0010 lists drag and drop among what isolates can't do with the DOM subset, so the editor's drag layer likely runs on the host or uses pointer events.
- **A `.isoloop.json` file:** the config of everything the user defined, so it can be rendered anywhere. It may be the same thing as decision 8's export file, and it is the Builder's own page format.
