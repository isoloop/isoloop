---
'@isoloop/host': minor
---

Component registry and sanitiser for rendering (invariant I9). Unknown tags render as `div` (`g` in SVG). `script`, `iframe`, `object`, `embed`, `style`, `on*` attributes and `srcdoc` are never created. URLs are limited to http(s), mailto and relative, and SVG `<use>` only to the same document. `KernelConfig.components` maps isolate tags to host elements, for example `{ 'iso-button': { tag: 'ds-button', attributes: ['variant'] } }`; a malformed entry makes `createKernel` throw `invalid_config`.
