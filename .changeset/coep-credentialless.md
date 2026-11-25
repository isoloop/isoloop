---
'@isoloop/vite': minor
---

`crossOriginIsolated` in `isoloop()` and `headersFor()` now also takes `'credentialless'`: the dev and preview servers send COOP `same-origin` with COEP `credentialless` instead of `require-corp`. Cross-origin `no-cors` requests then load without cookies, so third-party images and scripts without a `Cross-Origin-Resource-Policy` header aren't blocked. Chromium 96 and Firefox 119 on desktop isolate the page under it; Safari and Firefox for Android ignore the value, so there the page isn't cross-origin isolated. `true` sends `require-corp`, as before. The `'credentialless'` value is `@experimental`.
