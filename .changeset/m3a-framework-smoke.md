---
---

Preact and React render the same DOM in a worker as on the page, checked per major. The subset gains the DOM's event handler properties (`onclick`…), which Preact 10 and React check to learn event names. An element put into the worker's `document.head` (React 19's `<title>`) isn't rendered; the patch reports it, and the kernel warns once in `dev`.
