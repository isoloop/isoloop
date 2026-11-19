---
'@isoloop/webmcp': patch
---

`connectWebMCP` follows the differences between Chromium's and Firefox's WebMCP by feature detection: it uses `navigator.modelContext` where `document.modelContext` is missing, listens for `toolcancel` only where the context is an `EventTarget`, and on disconnect also calls `unregisterTool` for each tool where that exists. A tool's hints are sent only when true, because Firefox lists a tool as read-only whenever `readOnlyHint` is present, even as `false`. In Firefox a call can't be cancelled from the agent's side; it runs until its reply or its `timeoutMs`. A tool name an earlier `connectWebMCP` on the page registered and hasn't unregistered throws `KernelError('invalid_config')` naming the tool, and nothing is registered; before, Chromium rejected it while Firefox replaced the tool.
