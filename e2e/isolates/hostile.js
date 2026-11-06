// A hostile isoloop-dom isolate for the I9 E2E test (design §8): it tries to
// get scripts, frames, inline handlers and script URLs onto the page, along
// three paths:
//
// 1. through the DOM subset, with attributes set before the node is inserted
//    (they travel inside the `insert` record);
// 2. through the DOM subset, with attributes set after insertion (`attr`
//    records);
// 3. by posting a hand-made `patch` straight from the worker, skipping the
//    subset, the way real hostile code would.
//
// Every payload that ran would set `window.__pwned` on the page. Each probe
// carries `data-probe` so the test can find what it became.

/** @param {string} name */
const PWN = (name) => `window.__pwned=${JSON.stringify(name)}`;

/** @type {[probe: string, ns: 'html' | 'svg', tag: string, attrs: [string, string][]][]} */
const PROBES = [
  ['script', 'html', 'script', [['src', 'data:text/javascript,' + PWN('script-src')]]],
  ['iframe', 'html', 'iframe', [['srcdoc', `<script>parent.${PWN('srcdoc')}</script>`]]],
  ['object', 'html', 'object', [['data', 'javascript:' + PWN('object')]]],
  ['embed', 'html', 'embed', [['src', 'javascript:' + PWN('embed')]]],
  ['frame', 'html', 'frame', []],
  ['base', 'html', 'base', [['href', 'https://evil.example/']]],
  [
    'meta',
    'html',
    'meta',
    [
      ['http-equiv', 'refresh'],
      ['content', '0;url=javascript:' + PWN('meta')],
    ],
  ],
  [
    'link',
    'html',
    'link',
    [
      ['rel', 'stylesheet'],
      ['href', 'https://evil.example/x.css'],
    ],
  ],
  ['style', 'html', 'style', []],
  ['template', 'html', 'template', []],
  [
    'onclick',
    'html',
    'button',
    [
      ['onclick', PWN('onclick')],
      ['ONMOUSEOVER', PWN('onmouseover')],
    ],
  ],
  [
    'img-onerror',
    'html',
    'img',
    [
      ['src', 'x:broken'],
      ['onerror', PWN('onerror')],
    ],
  ],
  ['a-js', 'html', 'a', [['href', 'javascript:' + PWN('a-js')]]],
  ['a-js-case', 'html', 'a', [['href', '  JavaScript:' + PWN('a-js-case')]]],
  ['a-js-tab', 'html', 'a', [['href', 'java\tscript:' + PWN('a-js-tab')]]],
  ['a-data', 'html', 'a', [['href', 'data:text/html,<script>' + PWN('a-data') + '</script>']]],
  [
    'img-data-svg',
    'html',
    'img',
    [['src', 'data:image/svg+xml,<svg onload="' + PWN('img-svg') + '">']],
  ],
  ['form-action', 'html', 'form', [['action', 'javascript:' + PWN('form-action')]]],
  ['formaction', 'html', 'button', [['formaction', 'javascript:' + PWN('formaction')]]],
  ['srcset', 'html', 'img', [['srcset', 'javascript:x 1x']]],
  ['is', 'html', 'div', [['is', 'x-evil']]],
  ['style-url', 'html', 'p', [['style', 'background: url(javascript:' + PWN('style') + ')']]],
  ['svg-script', 'svg', 'script', []],
  ['svg-onload', 'svg', 'svg', [['onload', PWN('svg-onload')]]],
  ['svg-foreign', 'svg', 'foreignObject', []],
  [
    'svg-animate',
    'svg',
    'animate',
    [
      ['attributeName', 'href'],
      ['to', 'javascript:' + PWN('animate')],
    ],
  ],
  [
    'svg-set',
    'svg',
    'set',
    [
      ['attributeName', 'onclick'],
      ['to', PWN('set')],
    ],
  ],
  ['use-remote', 'svg', 'use', [['href', 'https://evil.example/sprite.svg#x']]],
  [
    'use-xlink',
    'svg',
    'use',
    [['xlink:href', 'data:image/svg+xml,<svg onload="' + PWN('use') + '"/>']],
  ],
  ['use-js', 'svg', 'use', [['href', 'javascript:' + PWN('use-js')]]],
];

const SVG = 'http://www.w3.org/2000/svg';

/** @param {unknown[]} batch */
const post = (batch) => self.postMessage({ v: 1, t: 'patch', p: { fmt: 'isoloop-dom@1', batch } });

/** @param {string} ns @param {string} tag */
const make = (ns, tag) =>
  ns === 'svg' ? document.createElementNS(SVG, tag) : document.createElement(tag);

export default {
  /** @param {{ root: Element }} ctx */
  start(ctx) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('data-probe', 'svg-host');
    ctx.root.append(svg);

    for (const [probe, ns, tag, attrs] of PROBES) {
      // Path 1: attributes inside the insert record.
      const before = make(ns, tag);
      before.setAttribute('data-probe', `insert:${probe}`);
      for (const [name, value] of attrs) before.setAttribute(name, value);
      (ns === 'svg' ? svg : ctx.root).append(before);

      // Path 2: attributes as attr records, after the node is in the tree.
      const after = make(ns, tag);
      after.setAttribute('data-probe', `attr:${probe}`);
      (ns === 'svg' ? svg : ctx.root).append(after);
      queueMicrotask(() => {
        for (const [name, value] of attrs) after.setAttribute(name, value);
      });
    }

    // A text node that looks like markup stays text.
    const text = document.createElement('p');
    text.setAttribute('data-probe', 'text');
    text.textContent = `<script>${PWN('text')}</script><img src=x onerror="${PWN('text-img')}">`;
    ctx.root.append(text);

    // Path 3: a hand-made patch, after the subset's own batches. Ids from
    // 100000 up can't collide with the subset's.
    setTimeout(() => {
      let id = 100_000;
      /** @type {unknown[]} */
      const batch = [];
      for (const [probe, ns, tag, attrs] of PROBES) {
        const node = {
          k: 'el',
          id: id++,
          tag,
          ns,
          attrs: [/** @type {[string, string]} */ (['data-probe', `raw:${probe}`]), ...attrs],
          props: [],
          listen: [],
          children: [],
        };
        batch.push(['insert', 0, node, null]);
        // The same attributes again as attr records on the inserted node.
        for (const [name, value] of attrs) batch.push(['attr', node.id, name, value]);
      }
      post(batch);
      // Records the format doesn't have make the host drop the whole batch.
      /** @param {string} probe @param {string} tag @param {string} ns @param {[string, string][]} [props] */
      const el = (probe, tag, ns, props = []) => ({
        k: 'el',
        id: id++,
        tag,
        ns,
        attrs: [['data-probe', probe]],
        props,
        listen: [],
        children: [],
      });
      post([['insert', 0, el('raw:bad-ns', 'script', 'xhtml'), null]]);
      post([
        [
          'insert',
          0,
          el('raw:bad-prop', 'input', 'html', [
            ['innerHTML', `<img src=x onerror="${PWN('prop')}">`],
          ]),
          null,
        ],
      ]);
      const input = el('raw:prop', 'input', 'html');
      post([['insert', 0, input, null]]);
      post([['prop', input.id, 'outerHTML', `<img src=x onerror="${PWN('prop2')}">`]]);
      post([['insert', 0, el('raw:done', 'p', 'html'), null]]);
    }, 50);
  },
};
