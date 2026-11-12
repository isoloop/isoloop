---
'@isoloop/runtime': patch
---

A pool's frozen built-ins no longer turn the properties V8 protects into accessors. These are the iteration protocol (`Symbol.iterator` on arrays, typed arrays, maps, sets and `%IteratorPrototype%`, and the iterators' `next`), `constructor` on arrays, typed arrays and promises, `Promise.prototype.then`, and all of `RegExp.prototype` and `String.prototype`. They stay plain frozen data, so V8 keeps its fast paths in pools. In a worker benchmark, `map` and `slice` were 23× slower with the old freeze, destructuring 3.6× and regexps 3.2×, and all of them are now within 2% of a plain worker (`bench/freeze`). Every other inherited property can still be overridden on an instance. Overriding one of the protected ones on an instance now throws in strict code (ADR 0001).
