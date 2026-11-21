/*
 * Frozen built-ins for pools (M2c task 7, decision 6). Pool members share one
 * realm, so a member that patches a built-in prototype (`Array.prototype.x =`)
 * changes it for every other member. Freezing the intrinsics' prototypes and
 * constructors first makes such a patch fail (a TypeError in strict code)
 * instead of leaking into the neighbours. Own workers are untouched.
 */

/** Constructors whose `prototype` and statics are frozen, if this engine has them. */
const NAMES = [
  'Object',
  'Function',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Date',
  'RegExp',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'ArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
] as const;

/**
 * Freezing a prototype makes its data properties read-only, and in strict
 * code assigning a property of the same name on an instance then throws (the
 * "override mistake": `this.name = 'MyError'`, `Foo.prototype.toString = …`,
 * or `Object.assign({}, { constructor: x })`). As Hardened JS does, each data
 * property becomes an accessor whose setter defines the property on the
 * instance instead, so overriding still works while the prototype itself
 * can't change.
 *
 * Except the properties V8 guards with "protectors": while they are still the
 * original data properties, V8 keeps fast paths for iteration (`for…of`,
 * spread, destructuring), species lookups and promise resolution. An accessor
 * returning the same function is enough to turn a protector off for the whole
 * worker: array iteration alone made a pool's app code 1.4–2.5× slower
 * (docs/investigations/plant-one-pool.md). These stay plain frozen data, so
 * overriding one of them on an instance throws in strict code instead
 * (ADR 0001, "Override taming without the protected properties").
 */
const ITERATOR = Symbol.iterator;

/** The protected properties, per prototype, that are left as frozen data. */
function protectedProperties(): Map<object, ReadonlySet<PropertyKey>> {
  const out = new Map<object, ReadonlySet<PropertyKey>>();
  const add = (o: unknown, ...keys: PropertyKey[]): void => {
    if ((typeof o !== 'object' && typeof o !== 'function') || o === null) return;
    out.set(o, new Set([...(out.get(o) ?? []), ...keys]));
  };
  const typedArrayCtor: unknown = Object.getPrototypeOf(Int8Array);
  const typedArray: unknown =
    typeof typedArrayCtor === 'function' ? Reflect.get(typedArrayCtor, 'prototype') : undefined;
  add(Array.prototype, ITERATOR, 'constructor');
  add(Object.getPrototypeOf([][Symbol.iterator]()), 'next');
  add(Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())), ITERATOR);
  add(typedArray, ITERATOR, 'constructor');
  for (const c of [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
  ])
    add(c.prototype, 'constructor');
  add(Map.prototype, ITERATOR);
  add(Object.getPrototypeOf(new Map()[Symbol.iterator]()), 'next');
  add(Set.prototype, ITERATOR);
  add(Object.getPrototypeOf(new Set()[Symbol.iterator]()), 'next');
  // String iteration checks the whole prototype: any accessor on it, whatever
  // its name, costs about 1.25× on `for…of` over a string.
  add(String.prototype, ...Reflect.ownKeys(String.prototype));
  add(Object.getPrototypeOf(''[Symbol.iterator]()), 'next');
  add(Promise.prototype, 'then', 'constructor');
  // RegExp's fast paths check the prototype's methods and `constructor`.
  add(RegExp.prototype, ...Reflect.ownKeys(RegExp.prototype));
  return out;
}

let skip: Map<object, ReadonlySet<PropertyKey>> | undefined;

function tameOverrides(proto: object): void {
  skip ??= protectedProperties();
  const keep = skip.get(proto);
  for (const key of Reflect.ownKeys(proto)) if (!keep?.has(key)) tameOverride(proto, key);
}

function tameOverride(proto: object, key: PropertyKey): void {
  const d = Object.getOwnPropertyDescriptor(proto, key);
  if (!d || !('value' in d) || !d.configurable) return;
  const value: unknown = d.value;
  Object.defineProperty(proto, key, {
    get() {
      return value;
    },
    set(this: unknown, v: unknown) {
      if (this === proto)
        throw new TypeError(
          `Cannot assign to read only property '${String(key)}' of a frozen built-in`,
        );
      if (typeof this !== 'object' && typeof this !== 'function') return;
      if (this === null) return;
      Object.defineProperty(this, key, {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
    enumerable: d.enumerable ?? false,
    configurable: false,
  });
}

function hardenProto(proto: unknown): void {
  if ((typeof proto !== 'object' && typeof proto !== 'function') || proto === null) return;
  if (Object.isFrozen(proto)) return;
  tameOverrides(proto);
  Object.freeze(proto);
}

function freezeWithPrototype(c: unknown): void {
  if (typeof c !== 'function') return;
  hardenProto(Reflect.get(c, 'prototype'));
  // V8 reads `Error.stackTraceLimit`, `prepareStackTrace` and friends from
  // the constructor, and libraries set them (React does): leave Error's statics.
  if (c !== Error) Object.freeze(c);
}

/** Freezes the shared intrinsics. Call once, before any member module loads. */
export function freezeBuiltins(): void {
  const g: object = globalThis;
  for (const name of NAMES) freezeWithPrototype(Reflect.get(g, name));
  // Prototypes reachable only from values: %TypedArray%, the iterators, generators.
  const typedArray: unknown = Object.getPrototypeOf(Int8Array);
  freezeWithPrototype(typedArray);
  const protos: unknown[] = [
    Object.getPrototypeOf([][Symbol.iterator]()),
    Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())),
    Object.getPrototypeOf(new Map()[Symbol.iterator]()),
    Object.getPrototypeOf(new Set()[Symbol.iterator]()),
    Object.getPrototypeOf(''[Symbol.iterator]()),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(async function* () {}),
  ];
  for (const p of protos) {
    if ((typeof p !== 'object' && typeof p !== 'function') || p === null) continue;
    hardenProto(Reflect.get(p, 'prototype'));
    hardenProto(p);
  }
  Object.freeze(Math);
  Object.freeze(JSON);
  Object.freeze(Reflect);
}
