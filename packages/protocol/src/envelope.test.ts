import { describe, expect, it } from 'vitest';
import { assertNever, isEnvelope, PROTOCOL } from './index';

describe('PROTOCOL', () => {
  it('speaks v1 and accepts v1', () => {
    expect(PROTOCOL).toEqual({ v: 1, min: 1 });
  });
});

describe('isEnvelope', () => {
  it.each([
    ['minimal', { v: 1, t: 'beat', p: { lagMs: 0 } }],
    ['with id', { v: 1, t: 'call', id: 'c1', p: {} }],
    ['with re', { v: 1, t: 'result', re: 'c1', p: { ok: true, value: 1 } }],
    ['payload undefined but present', { v: 1, t: 'x', p: undefined }],
    ['with isolate (a pool member)', { v: 1, t: 'ready', isolate: 'feed-t1', p: {} }],
  ])('accepts %s', (_name, x) => {
    expect(isEnvelope(x)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'beat'],
    ['an array', [1, 'beat', {}]],
    ['no v', { t: 'beat', p: {} }],
    ['unknown v', { v: 2, t: 'beat', p: {} }],
    ['v as string', { v: '1', t: 'beat', p: {} }],
    ['no t', { v: 1, p: {} }],
    ['t not a string', { v: 1, t: 7, p: {} }],
    ['no p', { v: 1, t: 'beat' }],
    ['id not a string', { v: 1, t: 'call', id: 1, p: {} }],
    ['re not a string', { v: 1, t: 'result', re: null, p: {} }],
    ['isolate not a string', { v: 1, t: 'event', isolate: 3, p: {} }],
  ])('rejects %s', (_name, x) => {
    expect(isEnvelope(x)).toBe(false);
  });
});

describe('assertNever', () => {
  it('throws with the value', () => {
    // Only reachable at runtime when the types are wrong, so call it untyped.
    expect(() => {
      Reflect.apply(assertNever, undefined, ['surprise', 'Unknown message']);
    }).toThrow('Unknown message: "surprise"');
  });
});
