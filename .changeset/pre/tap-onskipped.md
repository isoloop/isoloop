---
'@isoloop/host': minor
'@isoloop/runtime': minor
'@isoloop/devtools': minor
---

`tap()` on the host's `Inspector` and on `ctx.inspector` takes `onSkipped?: (count: number) => void` (`@experimental`). It gets each count of records the bus left out over `maxPerSec`, at most once a second (ADR 0020, decision 6, amended 2026-11-19). The devtools Log header shows the cap and the total skipped since the log was opened.
