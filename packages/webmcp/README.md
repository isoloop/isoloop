# @isoloop/webmcp

**Experimental.** Registers the tools an [Isoloop](https://github.com/isoloop/isoloop) app exposes (`agents.expose`) with the browser's [WebMCP](https://webmachinelearning.github.io/webmcp/) API, so an agent built into the browser can call them ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md)).

```sh
npm install @isoloop/webmcp@next @isoloop/host@next
```

```ts
import { createKernel } from '@isoloop/host';
import { connectWebMCP } from '@isoloop/webmcp';

const kernel = createKernel({ contracts, workers, agents: { expose: ['markets.quote.v1'] } });
const disconnect = connectWebMCP(kernel);
```

- **Each tool** from `kernel.tools()` is registered with its name, title, description, JSON Schemas and hints. A call runs `kernel.request(tool.topic, input, { timeoutMs: tool.timeoutMs, signal, via: 'webmcp' })` and resolves with the reply; a failed call rejects with the kernel's `BusError`.
- **Tools stay registered** while their isolates restart. The returned function unregisters them and aborts the calls still in flight.
- **Without WebMCP** it does nothing. There's no shim; in development, the dev MCP (`isoloop mcp`) covers other browsers.
- **Browsers:** WebMCP is a Community Group draft, behind a flag in Chromium (`--enable-features=WebMCP`) and behind prefs in Firefox (`dom.modelcontext.enabled`). They differ in where the API lives, which hints the agent sees, and whether a call can be cancelled; `connectWebMCP` follows the features each has, not its name.
- **Hints** tell the agent what a tool does. Asking the user before a consequential call is the agent's job.

How to make a topic a tool, idempotent handlers, the dev MCP and each browser's differences are in the [agents guide](https://github.com/isoloop/isoloop/blob/main/docs/guide/agents.md).
