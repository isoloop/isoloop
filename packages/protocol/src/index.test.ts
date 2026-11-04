import { describe, expect, it } from 'vitest';
import { PROTOCOL } from './index';

describe('PROTOCOL', () => {
  it('speaks v1 and accepts v1', () => {
    expect(PROTOCOL).toEqual({ v: 1, min: 1 });
  });
});
