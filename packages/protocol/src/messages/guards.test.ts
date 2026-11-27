import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BUS_TO_HOST,
  BUS_TO_ISOLATE,
  HOST_TO_BUS,
  HOST_TO_ISOLATE,
  ISOLATE_TO_BUS,
  ISOLATE_TO_HOST,
  isBusToHost,
  isBusToIsolate,
  isHostToBus,
  isHostToIsolate,
  isIsolateToBus,
  isIsolateToHost,
  type BusToHost,
  type BusToIsolate,
  type HostToBus,
  type HostToIsolate,
  type IsolateToBus,
  type IsolateToHost,
} from '../index';

const msg = (t: string, p: unknown): unknown => ({ v: 1, t, p });

const env = (t: string): unknown => ({ v: 1, t, p: {} });

const ports = [
  ['host → isolate', isHostToIsolate, HOST_TO_ISOLATE],
  ['isolate → host', isIsolateToHost, ISOLATE_TO_HOST],
  ['isolate → bus', isIsolateToBus, ISOLATE_TO_BUS],
  ['bus → isolate', isBusToIsolate, BUS_TO_ISOLATE],
  ['host → bus', isHostToBus, HOST_TO_BUS],
  ['bus → host', isBusToHost, BUS_TO_HOST],
] as const;

describe.each(ports)('%s guard', (_port, guard, types) => {
  it.each(Object.keys(types))('accepts %s', (t) => {
    expect(guard(env(t))).toBe(true);
  });

  it.each(['nope', 'toString', '__proto__', 'constructor', ''])('rejects unknown type %j', (t) => {
    expect(guard(env(t))).toBe(false);
  });

  it('rejects a known type with an unknown version', () => {
    const [t] = Object.keys(types);
    expect(guard({ v: 2, t, p: {} })).toBe(false);
  });
});

describe('guards are per port', () => {
  it.each([
    ['init is host → isolate only', 'init', [true, false, false, false, false, false]],
    ['patch is isolate → host only', 'patch', [false, true, false, false, false, false]],
    ['deliver is bus → isolate only', 'deliver', [false, false, false, true, false, false]],
    ['boot is host → bus only', 'boot', [false, false, false, false, true, false]],
    [
      'publish goes to the bus from isolate and host',
      'publish',
      [false, false, true, false, true, false],
    ],
    ['watch is isolate → bus only', 'watch', [false, false, true, false, false, false]],
    ['unwatch is isolate → bus only', 'unwatch', [false, false, true, false, false, false]],
    ['view is bus → isolate only', 'view', [false, false, false, true, false, false]],
    [
      'result goes to isolates from host and bus, and to the host from the bus',
      'result',
      [true, false, false, true, false, true],
    ],
  ] as const)('%s', (_name, t, expected) => {
    expect(ports.map(([, guard]) => guard(env(t)))).toEqual(expected);
  });
});

describe('message type maps list every type in their union', () => {
  it('type level', () => {
    expectTypeOf<keyof typeof HOST_TO_ISOLATE>().toEqualTypeOf<HostToIsolate['t']>();
    expectTypeOf<keyof typeof ISOLATE_TO_HOST>().toEqualTypeOf<IsolateToHost['t']>();
    expectTypeOf<keyof typeof ISOLATE_TO_BUS>().toEqualTypeOf<IsolateToBus['t']>();
    expectTypeOf<keyof typeof BUS_TO_ISOLATE>().toEqualTypeOf<BusToIsolate['t']>();
    expectTypeOf<keyof typeof HOST_TO_BUS>().toEqualTypeOf<HostToBus['t']>();
    expectTypeOf<keyof typeof BUS_TO_HOST>().toEqualTypeOf<BusToHost['t']>();
  });

  it('a guard narrows to its union', () => {
    const x: unknown = env('beat');
    if (isIsolateToHost(x)) expectTypeOf(x).toEqualTypeOf<IsolateToHost>();
  });
});

describe('watch messages (ADR 0023, point 13)', () => {
  it('accepts watch, unwatch and commits with seen', () => {
    expect(isIsolateToBus(msg('watch', { topic: 't' }))).toBe(true);
    expect(
      isIsolateToBus(
        msg('watch', {
          topic: 't',
          keys: ['a', null],
          have: [
            ['a', 3],
            [null, 0],
          ],
        }),
      ),
    ).toBe(true);
    expect(isIsolateToBus(msg('unwatch', { topic: 't' }))).toBe(true);
    expect(isIsolateToBus(msg('commits', { offsets: [], seen: [{ topic: 't', vseq: 2 }] }))).toBe(
      true,
    );
  });

  it('accepts view, with and without cleared', () => {
    const values = [{ key: null, version: 7, value: 1 }];
    expect(isBusToIsolate(msg('view', { topic: 't', vseq: 1, values }))).toBe(true);
    expect(isBusToIsolate(msg('view', { topic: 't', vseq: 2, values: [], cleared: ['a'] }))).toBe(
      true,
    );
  });

  it('rejects them on the wrong port', () => {
    expect(isBusToIsolate(msg('watch', { topic: 't' }))).toBe(false);
    expect(isIsolateToBus(msg('view', { topic: 't', vseq: 1, values: [] }))).toBe(false);
  });

  it('rejects an unknown version or a missing payload', () => {
    expect(isIsolateToBus({ v: 2, t: 'watch', p: { topic: 't' } })).toBe(false);
    expect(isIsolateToBus({ v: 1, t: 'watch' })).toBe(false);
    expect(isBusToIsolate({ v: 1, t: 'view', p: {}, id: 1 })).toBe(false);
  });

  it('types the payloads', () => {
    expectTypeOf<Extract<IsolateToBus, { t: 'watch' }>['p']['keys']>().toEqualTypeOf<
      readonly (string | null)[] | undefined
    >();
    expectTypeOf<Extract<BusToIsolate, { t: 'view' }>['p']['values'][number]>().toEqualTypeOf<{
      key: string | null;
      version: number;
      value: unknown;
    }>();
  });
});
