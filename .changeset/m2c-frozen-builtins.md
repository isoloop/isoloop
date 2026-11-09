---
'@isoloop/runtime': minor
---

A pool worker freezes the built-ins before its first member loads (M2c, decision 6): the prototypes and constructors of the standard built-ins, the iterator and generator prototypes, `Math`, `JSON` and `Reflect`. A member that patches one (`Array.prototype.x = …`) gets a TypeError instead of changing it for its neighbours. As in Hardened JS, inherited data properties become accessors first, so overriding them on an instance (`this.name = 'MyError'`) still works; `Error`'s statics (`stackTraceLimit`) stay writable. Own workers are untouched. With every isolate worker frozen this way, the runtime, React 18/19, Preact 10/11 and host suites and the E2E suite on Chromium, Firefox and WebKit passed.
