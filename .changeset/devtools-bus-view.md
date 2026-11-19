---
'@isoloop/devtools': minor
---

The panel has a Bus tab. It shows the bus's state and restart count, and, from the latest metrics:
- each topic's records and bytes a second, head and retained count;
- each subscription's lag and credit;
- rejected publishes by error code;
- the origin's storage use.

The tabs follow the WAI-ARIA tabs pattern, and each isolate's controls have an accessible name that includes its id.
