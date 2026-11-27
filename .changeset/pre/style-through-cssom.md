---
'@isoloop/dom': patch
'@isoloop/devtools': patch
'@isoloop/vite': patch
---

The host writes the `style` an isolate renders through the element's CSSOM (`el.style.cssText`) instead of `setAttribute('style', …)`, and the devtools panel styles its own page elements the same way. A page with surfaces now works under `style-src 'self'`, with no `'unsafe-inline'`: before, the browser dropped those styles and logged a violation for each. `devCsp()` still allows `'unsafe-inline'` in `style-src`, for the `<style>` elements Vite's dev server injects; its TSDoc and the hosting guide say so.
