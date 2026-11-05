import { describe, expect, it } from 'vitest';
import { createKernel, KernelError } from '../kernel';
import { createRegistry, isSafeUrl } from './registry';

const reg = createRegistry({
  components: { 'iso-button': { tag: 'ds-button', attributes: ['variant'] } },
});

describe('element (I9: unknown tags render as div)', () => {
  it.each([
    ['div', 'div'],
    ['BUTTON', 'button'],
    ['a', 'a'],
    ['img', 'img'],
    ['table', 'table'],
    ['td', 'td'],
    ['form', 'form'],
    ['select', 'select'],
    ['textarea', 'textarea'],
    ['h1', 'h1'],
    ['script', 'div'],
    ['iframe', 'div'],
    ['object', 'div'],
    ['embed', 'div'],
    ['style', 'div'],
    ['link', 'div'],
    ['meta', 'div'],
    ['base', 'div'],
    ['template', 'div'],
    ['frame', 'div'],
    ['made-up', 'div'],
    ['iso-button', 'ds-button'],
    ['ds-button', 'div'],
    ['constructor', 'div'],
    ['__proto__', 'div'],
  ])('html %s → %s', (tag, expected) => {
    expect(reg.element(tag, 'html')).toEqual({ tag: expected, ns: 'html' });
  });

  it.each([
    ['svg', 'svg'],
    ['path', 'path'],
    ['use', 'use'],
    ['linearGradient', 'linearGradient'],
    ['clippath', 'clipPath'],
    ['script', 'g'],
    ['foreignObject', 'g'],
    ['iframe', 'g'],
    ['animate', 'g'],
    ['set', 'g'],
  ])('svg %s → %s', (tag, expected) => {
    expect(reg.element(tag, 'svg')).toEqual({ tag: expected, ns: 'svg' });
  });
});

describe('attribute', () => {
  it.each([
    // on* never, on any tag or namespace, in any case
    ['button', 'html', 'onclick', 'alert(1)', null],
    ['div', 'html', 'ONMOUSEOVER', 'alert(1)', null],
    ['ds-button', 'html', 'onclick', 'x', null],
    ['svg', 'svg', 'onload', 'alert(1)', null],
    ['circle', 'svg', 'onbegin', 'x', null],
    // inline documents
    ['div', 'html', 'srcdoc', '<script>alert(1)</script>', null],
    ['ds-button', 'html', 'srcdoc', 'x', null],
    // URLs
    ['a', 'html', 'href', 'https://example.com/', 'https://example.com/'],
    ['a', 'html', 'href', '/relative?q=1', '/relative?q=1'],
    ['a', 'html', 'href', '#top', '#top'],
    ['a', 'html', 'href', 'mailto:me@example.com', 'mailto:me@example.com'],
    ['a', 'html', 'href', 'javascript:alert(1)', null],
    ['a', 'html', 'href', 'JavaScript:alert(1)', null],
    ['a', 'html', 'href', '  javascript:alert(1)', null],
    ['a', 'html', 'href', 'java\tscript:alert(1)', null],
    ['a', 'html', 'href', 'java\nscript:alert(1)', null],
    ['a', 'html', 'href', '\u0001javascript:alert(1)', null],
    ['a', 'html', 'href', 'vbscript:x', null],
    ['a', 'html', 'href', 'data:text/html,<script>alert(1)</script>', null],
    ['img', 'html', 'src', 'https://example.com/a.png', 'https://example.com/a.png'],
    ['img', 'html', 'src', 'data:image/svg+xml,<svg onload=alert(1)>', null],
    ['img', 'html', 'src', 'javascript:alert(1)', null],
    // SVG <use> may only reference the same document
    ['use', 'svg', 'href', '#icon', '#icon'],
    ['use', 'svg', 'href', 'https://evil.example/sprite.svg#icon', null],
    ['use', 'svg', 'xlink:href', 'data:image/svg+xml,<svg/>', null],
    ['use', 'svg', 'href', 'javascript:alert(1)', null],
    // attributes not on the allow-list for the tag
    ['div', 'html', 'href', 'https://example.com/', null],
    ['form', 'html', 'action', 'https://evil.example/', null],
    ['button', 'html', 'formaction', 'https://evil.example/', null],
    ['input', 'html', 'formaction', 'javascript:alert(1)', null],
    ['img', 'html', 'srcset', 'x.png 1x', null],
    ['div', 'html', 'is', 'x-y', null],
    // invalid names never reach setAttribute
    ['div', 'html', 'a b', 'x', null],
    ['div', 'html', '"x', 'x', null],
    // allowed attributes
    ['div', 'html', 'class', 'a b', 'a b'],
    ['div', 'html', 'aria-label', 'Close', 'Close'],
    ['div', 'html', 'data-key', 'k1', 'k1'],
    ['input', 'html', 'placeholder', 'Name', 'Name'],
    ['td', 'html', 'colspan', '2', '2'],
    ['path', 'svg', 'd', 'M0 0L1 1', 'M0 0L1 1'],
    ['svg', 'svg', 'viewBox', '0 0 10 10', '0 0 10 10'],
    ['ds-button', 'html', 'variant', 'primary', 'primary'],
    ['ds-button', 'html', 'size', 'large', null],
    // styles
    ['p', 'html', 'style', 'color: red', 'color: red'],
    ['p', 'html', 'style', 'background: url(javascript:alert(1))', null],
    ['p', 'html', 'style', 'width: expression(alert(1))', null],
    // link targets
    ['a', 'html', 'target', '_blank', '_blank'],
    ['a', 'html', 'target', 'some-window', null],
  ] as const)('%s[%s] %s=%j → %j', (tag, ns, name, value, expected) => {
    expect(reg.attribute(tag, ns, name, value)).toBe(expected);
  });
});

describe('property', () => {
  it.each([
    ['input', 'value', true],
    ['input', 'checked', true],
    ['textarea', 'value', true],
    ['select', 'value', true],
    ['option', 'selected', true],
    ['div', 'value', false],
    ['input', 'innerHTML', false],
    ['div', 'innerHTML', false],
    ['a', 'href', false],
    ['input', '__proto__', false],
  ] as const)('%s.%s → %s', (tag, name, expected) => {
    expect(reg.property(tag, name)).toBe(expected);
  });
});

describe('isSafeUrl', () => {
  it.each([
    ['', true],
    ['page', true],
    ['./a:b', true],
    ['HTTPS://x', true],
    ['ftp://x', false],
    ['blob:https://x/1', false],
    ['file:///etc/passwd', false],
  ])('%j → %s', (url, expected) => {
    expect(isSafeUrl(url)).toBe(expected);
  });
});

describe('host components', () => {
  it.each([
    [{ button: { tag: 'ds-button' } }, 'not a custom element name'],
    [{ 'iso-button': { tag: 'button' } }, 'not a custom element name'],
    [{ 'iso-button': { tag: 'ds-button', attributes: ['onclick'] } }, "can't be allowed"],
    [{ 'iso-button': { tag: 'ds-button', attributes: ['srcdoc'] } }, "can't be allowed"],
  ])('rejects %j', (components, message) => {
    expect(() => createRegistry({ components })).toThrow(message);
  });

  it('createKernel throws invalid_config for a bad entry', () => {
    let caught: unknown;
    try {
      createKernel({
        workers: { isolateBootstrap: 'unused' },
        components: { button: { tag: 'ds-button' } },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KernelError);
    expect(caught).toMatchObject({ code: 'invalid_config' });
  });
});
