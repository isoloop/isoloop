// Holds `config.mb` megabytes in its worker and idles, for the memory E2E
// (ADR 0020, decision 4: memory per isolate, measured by the host).

/** @type {unknown[]} */
const held = [];

export default {
  /** @param {{ config: unknown }} ctx */
  start(ctx) {
    const config = /** @type {{ mb?: number }} */ (ctx.config ?? {});
    const mb = typeof config.mb === 'number' ? config.mb : 0;
    // Numbers in a plain array: about 8 bytes each, on the worker's JS heap.
    for (let i = 0; i < mb; i++) held.push(Array.from({ length: 131_072 }, (_, j) => j + i * 0.5));
  },
};
