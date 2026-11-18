import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  REQUEST_VIA,
  isRecordReq,
  isRequestVia,
  type BusRecord,
  type RecordReq,
  type RequestVia,
} from './index';

describe('request records (ADR 0018, decision 4)', () => {
  it('knows the agent transports', () => {
    expect(REQUEST_VIA).toEqual(['mcp', 'webmcp', 'builder']);
    expectTypeOf<RequestVia>().toEqualTypeOf<'mcp' | 'webmcp' | 'builder'>();
    expectTypeOf<NonNullable<BusRecord['req']>>().toEqualTypeOf<RecordReq>();
  });

  it.each(REQUEST_VIA)('accepts via %s', (via) => {
    expect(isRequestVia(via)).toBe(true);
    expect(isRecordReq({ from: 'host', id: 'r1', via })).toBe(true);
  });

  it('accepts a req without via, as an isolate’s own bus.request sends', () => {
    expect(isRecordReq({ from: 'iso-a', id: 'r1' })).toBe(true);
  });

  it.each([
    ['an unknown via', { from: 'host', id: 'r1', via: 'email' }],
    ['a non-string via', { from: 'host', id: 'r1', via: 1 }],
    ['no from', { id: 'r1' }],
    ['a non-string id', { from: 'host', id: 1 }],
    ['null', null],
    ['a string', 'host'],
  ])('rejects %s', (_, x) => {
    expect(isRecordReq(x)).toBe(false);
  });

  it.each(['', 'MCP', 'toString', undefined, 1])('isRequestVia rejects %j', (x) => {
    expect(isRequestVia(x)).toBe(false);
  });
});
