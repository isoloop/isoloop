---
'@isoloop/protocol': minor
---

The wire protocol every Isoloop package shares: the message envelopes and guards for the host, isolate and bus ports, the error codes and `BusError`, grants, the kernel's events, the system topics (route, control), and the version helpers the host uses to check an isolate's `requires` against its supported range ([ADR 0012](https://github.com/isoloop/isoloop/blob/main/docs/adr/0012-isolates-built-apart.md)).

This entry replaces the interim notes written during development with the package as it stands before its first versioned prerelease.
