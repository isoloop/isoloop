// A canvas isolate for the E2E suite (M3a task 14): renders a <canvas>, takes
// it over with requestCanvas, and draws a red square from the worker.

/**
 * @typedef {{
 *   root: Element,
 *   host: { requestCanvas(node: Element, size?: { width?: number, height?: number }): Promise<OffscreenCanvas> },
 * }} Ctx
 */

export default {
  /** @param {Ctx} ctx */
  async start(ctx) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('class', 'square');
    canvas.setAttribute('style', 'display: block; width: 40px; height: 40px');
    const done = document.createElement('p');
    done.setAttribute('class', 'done');
    ctx.root.append(canvas, done);
    const off = await ctx.host.requestCanvas(canvas, { width: 40, height: 40 });
    const g = off.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.fillStyle = 'rgb(255, 0, 0)';
    g.fillRect(0, 0, 40, 40);
    done.textContent = 'drawn';
  },
};
