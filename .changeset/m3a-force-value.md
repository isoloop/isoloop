---
---

`ctx.setValue(node, value, { force: true })`: an isolate can set a host-owned input's value while the user is focused on it (the caret goes to the end). `isoloop-dom@1`'s `prop` record takes an optional `force` flag, amended in place (ADR 0010). Four-loops' D clears its note box this way instead of moving focus first.
