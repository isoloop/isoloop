# @isoloop/protocol

**Internal.** The wire protocol of [Isoloop](https://github.com/isoloop/isoloop): the message, event and error types that the kernel, the bus and isolates exchange. `@isoloop/host`, `@isoloop/runtime`, `@isoloop/bus` and the adapters depend on it. App code never imports it: the types it needs come re-exported from those packages, and this package's API carries no semver promise of its own.

| Entry | What it is |
| --- | --- |
| `@isoloop/protocol` | The envelopes, events, grants, bus and control messages, system topics and error codes, and the guards that check a message's shape. |
