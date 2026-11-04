import { describe, expect, it } from 'vitest';
import { isErrorCode, isSystemTopic, matchAny, matchTopic } from './index';

describe('matchTopic', () => {
  it.each([
    ['cart.items.v1', 'cart.items.v1', true],
    ['cart.items.v1', 'cart.items.v2', false],
    ['cart.items', 'cart.items.v1', false],
    ['catalog.*', 'catalog.items.v1', true],
    ['catalog.*', 'catalog.x', true],
    ['catalog.*', 'catalog.', false],
    ['catalog.*', 'catalog', false],
    ['catalog.*', 'catalogue.items', false],
    ['cart.*.v1', 'cart.items.v1', true],
    ['cart.*.v1', 'cart.items.v2', false],
    ['*', 'anything.at.all', true],
    ['*.v1', 'cart.items.v1', true],
    ['*.v1', 'cart.items.v10', false],
    // Regex metacharacters in a grant are literal.
    ['a+b.*', 'a+b.c', true],
    ['a+b.*', 'aab.c', false],
    ['cart.(x)', 'cart.(x)', true],
    ['cart.items.v1', 'cartXitems.v1', false],
    ['cart.*', 'cartXitems', false],
  ])('%j matches %j: %s', (grant, topic, expected) => {
    expect(matchTopic(grant, topic)).toBe(expected);
  });
});

describe('matchAny', () => {
  it('is true when any pattern matches', () => {
    expect(matchAny(['cart.*', 'catalog.*'], 'catalog.items.v1')).toBe(true);
  });

  it('is false for an empty list', () => {
    expect(matchAny([], 'cart.items.v1')).toBe(false);
  });
});

describe('isSystemTopic', () => {
  it.each([
    ['isoloop.route.v1', true],
    ['isoloop.', true],
    ['isoloopx.route', false],
    ['cart.isoloop.v1', false],
  ])('%j: %s', (topic, expected) => {
    expect(isSystemTopic(topic)).toBe(expected);
  });
});

describe('isErrorCode', () => {
  it.each([
    ['forbidden', true],
    ['protocol_mismatch', true],
    ['nope', false],
    [1, false],
  ])('%j: %s', (x, expected) => {
    expect(isErrorCode(x)).toBe(expected);
  });
});
