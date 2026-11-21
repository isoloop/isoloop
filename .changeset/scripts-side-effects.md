---
'@isoloop/bus': patch
'@isoloop/devtools': patch
---

`@isoloop/bus` and `@isoloop/devtools` name their scripts in `sideEffects`: the bus worker (`./dist/bus-worker.js`) and the devtools panel (`./dist/panel.js`) run code when they load, so a bundler that meets one in an `import` keeps it rather than dropping it. Their other files stay side-effect-free.
