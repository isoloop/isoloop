---
'@isoloop/host': minor
---

`createKernel` checks for module workers, `MessageChannel`, adopted stylesheets on a `ShadowRoot`, and OPFS. If any are missing it throws one `KernelError` with code `unsupported_browser`, naming everything that's missing.
