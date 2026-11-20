// Layout members throw NotSupportedError with a hint (ADR 0010, amended
// 2026-11-16, point 5): no fake values, and no bare `undefined`.
import { describe, expect, it } from 'vitest';
import { createDom, LAYOUT_METHODS, LAYOUT_PROPERTIES } from '../worker/dom';
import { install } from '../worker/install';

const setup = () => {
  const dom = createDom({ onBatch: () => {}, schedule: () => {} });
  return { dom, el: dom.document.createElement('div') };
};

const thrown = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e;
    throw new Error('expected an Error', { cause: e });
  }
  throw new Error('expected a throw');
};

const callable = (v: unknown): ((...a: unknown[]) => unknown) => {
  if (typeof v !== 'function') throw new Error('expected a function');
  return (...a): unknown => {
    const out: unknown = Reflect.apply(v, undefined, a);
    return out;
  };
};

const own = (): string => 'own';

describe('layout members', () => {
  it.each(Object.keys(LAYOUT_METHODS))(
    '%s() throws NotSupportedError naming what to use',
    (name) => {
      const { el } = setup();
      const fn: unknown = Reflect.get(el, name);
      if (typeof fn !== 'function') throw new Error('expected a method');
      const e = thrown(() => Reflect.apply(fn, el, []));
      expect(e.name).toBe('NotSupportedError');
      expect(e.message).toContain(`${name}()`);
      expect(e.message).toContain(LAYOUT_METHODS[name]);
    },
  );

  it.each(Object.keys(LAYOUT_PROPERTIES))(
    'reading %s throws NotSupportedError naming what to use',
    (name) => {
      const { el } = setup();
      const e = thrown(() => Reflect.get(el, name));
      expect(e.name).toBe('NotSupportedError');
      expect(e.message).toContain(name);
      expect(e.message).toContain('ctx.host.measure');
    },
  );

  it('the size and position hints point at ctx.host.measure', () => {
    expect(LAYOUT_METHODS.getBoundingClientRect).toContain('ctx.host.measure');
    expect(LAYOUT_METHODS.animate).toContain('CSS');
  });

  it('feature detection sees the members, as on a real element', () => {
    const { el } = setup();
    for (const name of [...Object.keys(LAYOUT_METHODS), ...Object.keys(LAYOUT_PROPERTIES)]) {
      expect(name in el).toBe(true);
    }
    expect(typeof Reflect.get(el, 'animate')).toBe('function');
  });

  it('scrollTop and scrollLeft still read the last scroll offsets', () => {
    const { el } = setup();
    expect(el.scrollTop).toBe(0);
    expect(el.scrollLeft).toBe(0);
  });

  it('install() gives the scope a getComputedStyle that throws NotSupportedError', () => {
    const { dom, el } = setup();
    const scope: Record<string, unknown> = {};
    install(dom, scope);
    const getComputedStyle = callable(scope['getComputedStyle']);
    const e = thrown(() => getComputedStyle(el));
    expect(e.name).toBe('NotSupportedError');
    expect(e.message).toContain('getComputedStyle()');
    expect(e.message).toContain('el.style');
  });

  it('install() keeps a getComputedStyle the scope already has', () => {
    const { dom } = setup();
    const scope: Record<string, unknown> = { getComputedStyle: own };
    install(dom, scope);
    expect(scope['getComputedStyle']).toBe(own);
  });
});
