import { describe, expect, it } from 'vitest';
import { h } from './vdom';

describe('h', () => {
  it('builds a node with props and children', () => {
    expect(h('p', { class: 'x' }, 'hi')).toEqual({ t: 'p', p: { class: 'x' }, c: ['hi'] });
  });

  it('defaults props to {}', () => {
    expect(h('div', null).p).toEqual({});
    expect(h('div').p).toEqual({});
  });

  it('flattens nested arrays and drops null, undefined and false', () => {
    const li = h('li', null, 'a');
    expect(h('ul', null, [li, [null, [li]]], undefined, false).c).toEqual([li, li]);
  });

  it('stringifies numbers and true', () => {
    expect(h('div', null, 0, 1.5, true).c).toEqual(['0', '1.5', 'true']);
  });
});
