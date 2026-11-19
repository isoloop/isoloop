# Tools for agents

An app can offer some of its requestable topics to AI agents as tools: a coding agent in development through the dev MCP, and a browser agent through WebMCP. Both call the same tool surface, and the isolate that answers doesn't know or care which one asked. The decisions are in [ADR 0018](../adr/0018-tools-for-agents.md). All of it is `@experimental` in 0.1.

```ts
// contracts.ts: a requestable topic (it has a `reply`) with a tool description
export const quoteTool = topic('markets.quote.v1', {
  schema: s.quoteRequest,
  reply: s.quoteReply,
  retention: { kind: 'last-n', n: 100 },
  tool: {
    title: 'Quote',
    description:
      "The latest figures for one symbol: VWAP, cross-market spread and volume over the dashboard's window (null with no trades in it), and each exchange's last, bid and ask.",
    readOnly: true,
  },
});

// main.ts: the kernel lists which topics agents may call
const kernel = createKernel({ contracts, workers, agents: { expose: ['markets.quote.v1'] } });
```

The worked example throughout is the markets dashboard ([isoloop/web `apps/dashboards/markets`](https://github.com/isoloop/web/tree/main/apps/dashboards/markets)). It exposes two tools: `markets.quote.v1`, a read-only quote answered by the aggregator isolate, and `markets.alerts.create.v1`, which adds an alert rule through the alerts isolate.

## A topic as a tool

A tool is a topic with a `reply` schema and a `tool` field. Its name is always the topic's name.

| `tool` field | Meaning |
| --- | --- |
| `description` | Required. What the tool does, for the agent choosing it. |
| `readOnly` | Required. `true` if a call changes nothing. WebMCP and MCP `readOnlyHint`. |
| `title` | A short human-readable name. |
| `consequential` | The call has effects the user should confirm. WebMCP `consequentialHint`, MCP `destructiveHint`. Default `false`. |
| `untrustedContent` | The reply can carry third-party text. WebMCP `untrustedContentHint`. Default `false`. |

The `tool` field stays on the host: it isn't part of the topic config the bus sees, and a `tool` field alone exposes nothing.

## Exposing tools: `agents.expose`

```ts
createKernel({
  contracts,
  agents: { expose: ['markets.quote.v1', 'markets.alerts.*'], timeoutMs: 10_000 },
});
```

- **`expose`** takes grant matchers: `*` for one segment, `>` for the rest.
- **Every topic it matches** needs a `reply`, a `tool` with a non-empty `description` and a boolean `readOnly`, and schemas that make JSON Schema (Standard JSON Schema, draft 2020-12). Otherwise `createKernel` throws `KernelError('not_exposable')`, naming the topic. A schema built with `unchecked()` can't make JSON Schema, so its topic can't be a tool.
- **A pattern that matches nothing** isn't an error. It's reported once, through the `agents:unmatched` event: `kernel.on('agents:unmatched', ({ patterns }) => …)`.
- **`timeoutMs`** is how long transports wait for a tool's reply. Default 10 s.
- **`kernel.tools()`** lists the exposed tools, made once at `createKernel`: name, title, description, the three hints, the input and output JSON Schemas, `timeoutMs`, and `topic`. Everything but `topic` is plain data. It's empty without `agents`.

## Answering a tool call

An isolate answers a tool call the way it answers any request: it subscribes to the topic and replies to records that carry `req`. Markets' alerts isolate:

```ts
export default defineIsolate({
  start(ctx) {
    const svc = runAlerts(busSource(ctx.bus));
    ctx.bus.subscribe(
      createAlertTool,
      async (r) => {
        if (r.req === undefined) return;            // a plain record, not a request
        await ctx.bus.reply(r, svc.create(r.req.id, r.value));
      },
      { from: 'committed' },
    );
  },
});
```

The isolate needs a subscribe grant for the topic, as for any request. The first valid reply wins, checked against the `reply` schema.

### Handlers must be idempotent

Delivery is at least once, as for every handler on the bus. A crash after the handler's side effect but before its reply delivers the request again, so a tool that changes something would do it twice. Its handler has to recognise a request it has already handled by `req.id`. Markets derives the rule's id from the request's id (`agent-${req.id}`) and publishes the rule under that key, so a request delivered again adds nothing new:

```ts
create(requestId, rule) {
  const id = `agent-${requestId}`;
  const created = !engine.has(id);
  if (created) engine.setRule({ removed: false, id, ...rule });
  src.publish('alertRules', { removed: false, id, ...rule }, id);
  return { id, created };
}
```

The bus doesn't de-duplicate request records itself.

## Calling from the host: `kernel.request`

Transports call tools through `kernel.request`. It works on any requestable topic, exposed to agents or not.

```ts
const tool = kernel.tools().find((t) => t.name === 'markets.quote.v1')!;
const reply = await kernel.request(tool.topic, { symbol: 'BTC-USD' }, {
  timeoutMs: tool.timeoutMs,
  signal,                 // aborting rejects with `aborted`
  via: 'webmcp',          // set on the record as `req.via`
});
```

| Option | Meaning |
| --- | --- |
| `timeoutMs` | Default 30 s, the bus's. Transports pass the tool's `timeoutMs` (10 s unless `agents.timeoutMs` says otherwise). |
| `signal` | Aborting it rejects the call with `BusError('aborted')`. |
| `via` | `'mcp'`, `'webmcp'` or `'builder'`: the transport making the call. Anything else is `invalid`. |
| `key` | The request record's key. |

It rejects with a `BusError`:
- `no_responder` at once when no isolate could answer: none has a subscribe grant for the topic, or every one that has is stopped or `failed`. Passing this check doesn't promise a reply.
- `timeout` after `timeoutMs`. An isolate that restarts within the timeout still gets the request and can answer it.
- `aborted` when `signal` aborts.
- `forbidden` for `isoloop.*` topics, and `unknown_topic`, `not_requestable`, `invalid`, `reply_invalid` and `bus_unavailable`, as `bus.request` does.

## What the hints do and don't do

- **They describe; they don't enforce.** `readOnly`, `consequential` and `untrustedContent` are passed to the agent as hints. Nothing in Isoloop stops a call because of them, apart from the dev MCP's `--allow-write` below.
- **Asking the user is the agent's job.** A consequential tool runs on agent input. WebMCP also leaves confirmation to the agent. If a tool must not run without the user's say, the app has to ask in its own UI.
- **`via` is not a security boundary.** Any code on the main thread can call `kernel.request` with any `via`. It's a label for logging and policy between cooperating code on one page. Don't authorize anything by it.
- **An untrusted reply:** with `untrustedContent: true`, the reply can carry third-party text (markets' quotes don't; a tool returning user comments would). The agent should treat it as data, not instructions.

## In development: the dev MCP

`isoloop mcp` (the `isoloop` package's CLI) is an MCP server over stdio for coding agents. Pages in development dial its WebSocket on `127.0.0.1`, and it lists their exposed tools plus its own `isoloop_*` tools for reading the page.

```bash
claude mcp add isoloop -- npx isoloop mcp                  # Claude Code
claude mcp add isoloop -- npx isoloop mcp --allow-write    # also the tools that change something
```

Or in a project's `.mcp.json`:

```json
{ "mcpServers": { "isoloop": { "command": "npx", "args": ["isoloop", "mcp"] } } }
```

In the page, behind `import.meta.env.DEV`:

```ts
if (import.meta.env.DEV) {
  const token = import.meta.env.VITE_ISOLOOP_MCP_TOKEN;
  if (token) {
    const { connectDevMCP } = await import('@isoloop/host/dev-mcp');
    connectDevMCP(kernel, { token, title: 'markets' });
  }
}
```

- **Pairing:** any site open in the browser can dial `127.0.0.1`, so the CLI accepts a page only with its token and only from an allowed `Origin` (`--origin`, default `http://localhost:*`; comma separated, `*` for any). The CLI prints a fresh token on stderr at each start. For a fixed one, set the same value twice: `ISOLOOP_MCP_TOKEN` for the CLI and `VITE_ISOLOOP_MCP_TOKEN` for the page (Vite only shows the page `VITE_` variables).
- **Port:** `--port`, default `4317`; the page's `url` option defaults to `ws://127.0.0.1:4317`. The page keeps trying while the CLI isn't running and reconnects after it restarts, backing off to one try every 30 s. A wrong token stops it.
- **`--allow-write`:** without it, the CLI lists only tools with `readOnly: true` and its own reads. With it, it also lists the app's other tools and its writes.
- **Its own tools:** `isoloop_pages` lists the connected pages; every other tool takes an optional `page` (default: the page that connected last among those exposing the tool). The reads come from the page's inspection feed ([inspection guide](inspection.md)): `isoloop_isolates`, `isoloop_topics`, `isoloop_records` (what a topic retains), `isoloop_tap` and `isoloop_events`. `isoloop_tap { topics, ms?, max? }` is a live sample: it taps the topics for `ms` (3 s by default, at most 10 s), stops early at `max` records (at most 100), and returns `{ records, skipped, ms }`. Like the panel's log, it gets at most 50 records a second; `skipped` is how many the bus left out over that, reported once a second, so the last second's count can be missing. The writes need `--allow-write`: `isoloop_restart`, `isoloop_kill`, `isoloop_block`, `isoloop_publish` and `isoloop_request`. Their names are reserved: an app tool with the same name isn't listed.
- **Calls** go through `kernel.request(…, { via: 'mcp' })` with the tool's `timeoutMs`.
- **Production builds:** `@isoloop/vite` fails a production build whose output still contains `connectDevMCP`. Imported behind `if (import.meta.env.DEV)`, it's dropped and the build passes. `isoloop({ allowDevMcp: true })` turns the check off.

Markets runs both of its tools through the official MCP SDK client and the real CLI in its E2E (`e2e/dev-mcp.spec.ts`, Chromium).

## In the browser: `@isoloop/webmcp`

[WebMCP](https://webmachinelearning.github.io/webmcp/) is a Community Group draft for pages to offer tools to an agent built into the browser. `@isoloop/webmcp` registers the kernel's exposed tools with it:

```ts
import { connectWebMCP } from '@isoloop/webmcp';

const disconnect = connectWebMCP(kernel);
// later: disconnect();
```

- **Each tool** is registered with its name, title, description, input and output JSON Schemas and hints. A call runs `kernel.request(tool.topic, input, { timeoutMs: tool.timeoutMs, signal, via: 'webmcp' })` and resolves with the reply.
- **Tools stay registered** while their isolates restart.
- **Disconnecting** unregisters every tool and aborts the calls still in flight.
- **Without WebMCP** it does nothing and returns a function that does nothing. There's no shim; in development the dev MCP covers other browsers.

Both browsers that have WebMCP keep it behind a flag. It's tested under Playwright only: Chromium with `--enable-features=WebMCP`, and Firefox with `dom.modelcontext.enabled`. The two differ, and `connectWebMCP` follows the features each one has, not its name ([ADR 0018](../adr/0018-tools-for-agents.md), decision 8, amended 2026-11-19):

| | Chromium 158 | Firefox 159 |
| --- | --- | --- |
| Where | `document.modelContext` | `navigator.modelContext` |
| Hints the agent sees | all three | only `readOnlyHint`; no title |
| Cancelling a call from the agent | yes | no: the call runs until its reply or its `timeoutMs`, then the agent gets `timeout` |
| What the agent sees when a call fails | "Tool execution failed"; the `BusError` is only in the page's console | the `BusError`'s message |

- **Hints are sent only when true,** because Firefox lists a tool as read-only whenever `readOnlyHint` is present, even as `false`. The draft's defaults are false, so Chromium lists the same thing.
- **Firefox's agent doesn't see `consequentialHint` or `untrustedContentHint`,** so it can't tell a consequential tool from any other that isn't read-only, or know that a reply can carry third-party text. Descriptions aren't edited to make up for it. If confirmation matters, ask the user in the page.
- **Cancelling in Chromium** names only the tool, so it aborts every call of that tool in flight.
- **A tool name registered twice:** a `connectWebMCP` whose tools an earlier one on the page registered, and hasn't unregistered, throws `KernelError('invalid_config')` naming the tool, and registers nothing. That's the same on both browsers; on their own, Chromium rejects the name and Firefox replaces the tool.
