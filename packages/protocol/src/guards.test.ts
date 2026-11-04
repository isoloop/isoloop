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
} from './index';

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
    [
      'result goes to isolates from host and bus',
      'result',
      [true, false, false, true, false, false],
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
