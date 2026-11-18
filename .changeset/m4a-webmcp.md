---
'@isoloop/webmcp': minor
---

New package, `@experimental`: `connectWebMCP(kernel)` registers the tools an app exposes through `agents.expose` with the browser's WebMCP API (`document.modelContext`, behind `--enable-features=WebMCP` in Chromium), with their JSON Schemas and hints ([ADR 0018](https://github.com/isoloop/isoloop/blob/main/docs/adr/0018-tools-for-agents.md), decision 8). A call runs `kernel.request(…, { via: 'webmcp' })` with the tool's timeout and resolves with the reply, or rejects with the kernel's `BusError`. The browser cancelling a call aborts it, and the returned function unregisters every tool. Where `document.modelContext` is missing it does nothing. Firefox exposes WebMCP at `navigator.modelContext` (behind `dom.modelcontext.enabled`), which `connectWebMCP` does not look up.
