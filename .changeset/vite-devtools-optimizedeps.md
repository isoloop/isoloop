---
'@isoloop/vite': patch
'@isoloop/devtools': patch
---

In dev, `@isoloop/vite` keeps `@isoloop/devtools` out of dependency pre-bundling (`optimizeDeps.exclude`), so the panel's default URL (`new URL('./panel.js', import.meta.url)`) reaches the published `panel.js`. With `@isoloop/vite`, `connectDevtools` needs no `src`; with another bundler, pass the URL it serves `@isoloop/devtools/panel` at.
