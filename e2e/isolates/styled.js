// Sets `style` every way an isolate can, for the strict-CSP test (csp.spec.ts):
// through `el.style`, with setAttribute, on SVG, in the first render and after it.

export default {
  /** @param {{ root: Element | undefined }} ctx */
  start(ctx) {
    if (!ctx.root) return;
    const byProperty = document.createElement('p');
    byProperty.setAttribute('data-probe', 'property');
    byProperty.style.color = 'rgb(1, 2, 3)';
    byProperty.style.setProperty('margin-left', '7px');

    const byAttribute = document.createElement('p');
    byAttribute.setAttribute('data-probe', 'attribute');
    byAttribute.setAttribute('style', 'color: rgb(4, 5, 6); padding-top: 9px');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('data-probe', 'svg');
    rect.setAttribute('style', 'fill: rgb(7, 8, 9)');
    svg.appendChild(rect);

    const later = document.createElement('p');
    later.setAttribute('data-probe', 'later');
    ctx.root.append(byProperty, byAttribute, svg, later);

    // After the first render: an attr record on a node the host already has.
    setTimeout(() => {
      later.style.cssText = 'color: rgb(10, 11, 12)';
      later.setAttribute('data-done', '');
    }, 50);
  },
};
