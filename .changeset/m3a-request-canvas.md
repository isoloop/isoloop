---
---

`ctx.host.requestCanvas(node, size?)`: the host hands the `<canvas>` it rendered for the node to the isolate as an `OffscreenCanvas` (once per canvas; headless isolates get `no_surface`), and `resize` events with its CSS size follow. `<canvas>` with `width` and `height` joins the component registry.
