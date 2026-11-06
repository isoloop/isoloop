/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import './harness-types';
import { HARNESS, ISOLATES_CORS } from './servers';

// I9 (design §8) end to end: whatever an isolate sends, through the DOM
// subset or as a hand-made patch, no script, frame, inline handler or script
// URL reaches the page. Unit tests cover the registry's rules; this covers
// the path isolate → records → applier → registry → real DOM.

type Report = {
  probes: Record<string, string>;
  violations: string[];
  text: { content: string; children: number } | null;
};

test('I9: a hostile isolate gets no script, frame, handler or script URL onto the page', async ({
  page,
}) => {
  await page.goto(HARNESS);
  await expect(page.locator('body[data-ready]')).toBeAttached();
  await page.evaluate((src) => {
    const crashes: string[] = [];
    Object.assign(window, { crashes });
    const kernel = window.harness.createKernel();
    kernel.on('isolate:crash', (e) => crashes.push(e.message));
    const surface = document.createElement('section');
    document.getElementById('root')?.append(surface);
    kernel.spawn({ id: 'H', src, surface });
  }, new URL('hostile.js', ISOLATES_CORS).href);
  await expect(page.locator('iso-surface [data-probe="raw:done"]')).toBeAttached();

  const report: Report = await page.evaluate(() => {
    const root = document.querySelector('iso-surface')?.shadowRoot;
    if (!root) throw new Error('no surface');
    const BAD_TAGS = new Set([
      'script',
      'iframe',
      'object',
      'embed',
      'frame',
      'frameset',
      'base',
      'meta',
      'link',
      'style',
      'template',
      'foreignobject',
      'animate',
      'set',
    ]);
    const BAD_ATTRS = new Set(['srcdoc', 'formaction', 'action', 'srcset', 'is', 'http-equiv']);
    const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'data', 'action', 'formaction']);
    const probes: Record<string, string> = {};
    const violations: string[] = [];
    for (const el of root.querySelectorAll('*')) {
      const probe = el.getAttribute('data-probe') ?? `(no probe) ${el.localName}`;
      probes[probe] = el.localName;
      if (BAD_TAGS.has(el.localName.toLowerCase())) violations.push(`${probe}: <${el.localName}>`);
      for (const { name, value } of el.attributes) {
        const n = name.toLowerCase();
        if (n.startsWith('on')) violations.push(`${probe}: ${name}`);
        if (BAD_ATTRS.has(n)) violations.push(`${probe}: ${name}`);
        // URL parsing strips control characters and spaces, so they're stripped here too.
        // oxlint-disable-next-line no-control-regex -- matching them is the point
        const url = value.replaceAll(/[\u0000- ]/g, '').toLowerCase();
        if (URL_ATTRS.has(n) && /^(javascript|vbscript|data):/.test(url))
          violations.push(`${probe}: ${name}=${value}`);
        if (n === 'style' && /url\(|expression\(/i.test(value))
          violations.push(`${probe}: style=${value}`);
      }
      if (/^(input|textarea)$/.test(el.localName) && el.childElementCount > 0)
        violations.push(`${probe}: children inside <${el.localName}>`);
    }
    const t = root.querySelector('[data-probe="text"]');
    return {
      probes,
      violations,
      text: t ? { content: t.textContent ?? '', children: t.childElementCount } : null,
    };
  });

  expect(report.violations).toEqual([]);
  // Every probe arrived, on all three paths, as something harmless.
  const expectations: [string, string][] = [
    ['script', 'div'],
    ['iframe', 'div'],
    ['object', 'div'],
    ['embed', 'div'],
    ['frame', 'div'],
    ['base', 'div'],
    ['meta', 'div'],
    ['link', 'div'],
    ['style', 'div'],
    ['template', 'div'],
    ['onclick', 'button'],
    ['a-js', 'a'],
    ['svg-script', 'g'],
    ['svg-foreign', 'g'],
    ['svg-animate', 'g'],
    ['svg-set', 'g'],
    ['use-remote', 'use'],
  ];
  for (const path of ['insert', 'attr', 'raw'])
    for (const [probe, tag] of expectations)
      expect(report.probes[`${path}:${probe}`], `${path}:${probe}`).toBe(tag);
  // Batches with records the format doesn't have are dropped whole.
  expect(report.probes['raw:bad-ns']).toBeUndefined();
  expect(report.probes['raw:bad-prop']).toBeUndefined();
  expect(report.probes['raw:prop']).toBe('input');
  // Markup in text stays text.
  expect(report.text?.children).toBe(0);
  expect(report.text?.content).toMatch(/^<script>.*<img src=x onerror=/);

  // Poke everything: nothing may run.
  await page.evaluate(() => {
    const root = document.querySelector('iso-surface')?.shadowRoot;
    for (const el of root?.querySelectorAll('[data-probe]') ?? []) {
      for (const type of ['click', 'mouseover', 'load', 'error', 'begin'])
        el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate((): unknown => Reflect.get(window, '__pwned'))).toBeUndefined();
  expect(page.frames()).toHaveLength(1);
  expect(await page.evaluate((): unknown => Reflect.get(window, 'crashes'))).toEqual([]);
});
