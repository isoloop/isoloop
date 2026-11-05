// A visual isolate for the routing E2E tests (plan m2-bus task 10, ADR 0002).
// Shows the current route path, navigates on "go", and renders a link.
//
// config: { to?: string, link?: string, subscribe?: boolean }

/**
 * @typedef {{ value: { path: string | null }, ts: number }} RouteRecord
 * @typedef {{
 *   config: { to?: string, link?: string, subscribe?: boolean } | null,
 *   root: Element,
 *   host: { navigate(href: string): Promise<boolean> },
 *   bus: {
 *     subscribe(
 *       topic: { name: string },
 *       fn: (r: RouteRecord) => void,
 *       opts: { from: string, onReset: () => void },
 *     ): () => void,
 *   },
 * }} Ctx
 */

const route = { name: 'isoloop.route.v1' };

/** @param {string} cls @param {string} [text] */
function p(cls, text = '') {
  const el = document.createElement('p');
  el.setAttribute('class', cls);
  el.textContent = text;
  return el;
}

export default {
  /** @param {Ctx} ctx */
  start(ctx) {
    const config = ctx.config ?? {};
    const path = p('path', '…');
    const seen = p('seen', '0');
    const resets = p('resets', '0');
    const result = p('result');
    const committed = p('committed');
    const go = document.createElement('button');
    go.setAttribute('class', 'go');
    go.textContent = 'go';
    const link = document.createElement('a');
    link.setAttribute('class', 'link');
    link.setAttribute('href', config.link ?? '/linked');
    link.textContent = 'link';

    /** @type {{ path: string | null, ts: number }[]} */
    const records = [];
    let resolvedAt = 0;
    let target = '';
    // Strict ordering check: the route record for the target must have been
    // appended (its `ts`) before navigate() resolved.
    const check = () => {
      const rec = records.find((r) => r.path === target);
      if (resolvedAt && rec) committed.textContent = rec.ts <= resolvedAt ? 'yes' : 'no';
    };

    if (config.subscribe !== false) {
      ctx.bus.subscribe(
        route,
        (r) => {
          path.textContent = r.value.path ?? '(outside)';
          seen.textContent = String(Number(seen.textContent) + 1);
          records.push({ path: r.value.path, ts: r.ts });
          check();
        },
        {
          from: 'earliest',
          onReset: () => {
            resets.textContent = String(Number(resets.textContent) + 1);
          },
        },
      );
    }

    go.addEventListener('click', () => {
      target = config.to ?? '/x';
      ctx.host.navigate(target).then(
        (/** @type {boolean} */ ok) => {
          resolvedAt = Date.now();
          result.textContent = String(ok);
          check();
        },
        (/** @type {{ code?: string }} */ e) => {
          result.textContent = e.code ?? 'error';
        },
      );
    });

    ctx.root.append(path, seen, resets, result, committed, go, link);
  },
};
