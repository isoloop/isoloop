# @isoloop/webmcp

## 0.1.0-next.8

### Patch Changes

- Updated dependencies [6fc09f6]
  - @isoloop/host@0.1.0-next.8

## 0.1.0-next.7

### Patch Changes

- 3c354e8: A request that the topic's retention removes before the bus delivers it to any subscriber now fails at once with the new error code `dropped`, with the message "the request was dropped: the topic's retention was full; retry or raise retention" (ADR 0018, decision 5). Before, its caller waited out the whole timeout. It applies to `kernel.request` and to an isolate's own `bus.request`; a request already delivered stays its responder's to answer, and retention keeps its meaning. On a topic keeping 100 records, a burst of 1,000 calls at once now gets 100 answers and 900 `dropped`. The dev MCP reports it as a tool error, `dropped: <message>`, and `@isoloop/webmcp` rejects with the `BusError`. Size a tool's topic's retention for its largest burst of calls.
- Updated dependencies [3c354e8]
  - @isoloop/host@0.1.0-next.7

## 0.1.0-next.6

### Patch Changes

- Updated dependencies [8e04ddf]
  - @isoloop/host@0.1.0-next.6

## 0.1.0-next.5

### Patch Changes

- 2eadfe7: `connectWebMCP` follows the differences between Chromium's and Firefox's WebMCP by feature detection: it uses `navigator.modelContext` where `document.modelContext` is missing, listens for `toolcancel` only where the context is an `EventTarget`, and on disconnect also calls `unregisterTool` for each tool where that exists. A tool's hints are sent only when true, because Firefox lists a tool as read-only whenever `readOnlyHint` is present, even as `false`. In Firefox a call can't be cancelled from the agent's side; it runs until its reply or its `timeoutMs`. A tool name an earlier `connectWebMCP` on the page registered and hasn't unregistered throws `KernelError('invalid_config')` naming the tool, and nothing is registered; before, Chromium rejected it while Firefox replaced the tool.
- Updated dependencies [080059d]
  - @isoloop/host@0.1.0-next.5

## 0.1.0-next.4

### Minor Changes

- d95f239: New package, `@experimental`: `connectWebMCP(kernel)` registers the tools an app exposes through `agents.expose` with the browser's WebMCP API (`document.modelContext`, behind `--enable-features=WebMCP` in Chromium), with their JSON Schemas and hints ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 8). A call runs `kernel.request(…, { via: 'webmcp' })` with the tool's timeout and resolves with the reply, or rejects with the kernel's `BusError`. The browser cancelling a call aborts it, and the returned function unregisters every tool. Where `document.modelContext` is missing it does nothing. Firefox exposes WebMCP at `navigator.modelContext` (behind `dom.modelcontext.enabled`), which `connectWebMCP` does not look up.

### Patch Changes

- @isoloop/host@0.1.0-next.4
