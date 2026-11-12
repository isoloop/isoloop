// Test pool member (M2c): headless. Publishes its own id on its own bus port,
// so a test can tell which member reached which port; throws in start() when
// its config asks for it.
type Ctx = {
  id: string;
  config: unknown;
  bus: { publish(topic: { name: string }, rec: { value: unknown }): Promise<void> };
  onShutdown(fn: () => void): void;
};

const own = (): string => 'own';

/** Whether assigning `key` on `target` defines it there (strict code: no throw). */
function sets(target: object, key: PropertyKey): boolean {
  // Reflect.set returns false where a strict-mode assignment would throw.
  return (
    Reflect.set(target, key, own) && Object.getOwnPropertyDescriptor(target, key)?.value === own
  );
}

/** The names in `o` whose check didn't come out as `want`. */
function where(o: Record<string, boolean>, want: boolean): string[] {
  return Object.keys(o).filter((k) => o[k] !== want);
}

function isData(o: object, key: PropertyKey): boolean {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d !== undefined && 'value' in d;
}

export default {
  start(ctx: Ctx): void {
    if (ctx.config === 'throw') throw new Error(`start failed in ${ctx.id}`);
    if (ctx.config === 'patch') {
      // Built-ins are frozen in a pool: patching one fails, overriding an
      // inherited property on an instance still works.
      let patched = true;
      try {
        Reflect.set(Array.prototype, 'leak', 1);
        patched = Reflect.get([], 'leak') === 1;
      } catch {
        patched = false;
      }
      class MyError extends Error {
        constructor() {
          super('x');
          this.name = 'MyError';
        }
      }
      const report = {
        patched,
        override: new MyError().name,
        frozen: Object.isFrozen(Array.prototype),
      };
      void ctx.bus.publish({ name: 'hello' }, { value: report }).catch(() => {});
      return;
    }
    if (ctx.config === 'taming') {
      // Which inherited names an instance can still override (module code is
      // strict), and which built-ins kept plain data properties.
      class E extends TypeError {}
      class B extends Uint8Array {}
      const iteratorProto: object =
        Reflect.getPrototypeOf(Reflect.getPrototypeOf([][Symbol.iterator]()) ?? {}) ?? {};
      const report = {
        overridable: {
          'Object toString': sets({}, 'toString'),
          'Object constructor': sets({}, 'constructor'),
          'Object.assign with a constructor key': (() => {
            try {
              return Object.assign({}, { constructor: 1 }).constructor === 1;
            } catch {
              return false;
            }
          })(),
          'Function toString': sets(function () {}, 'toString'),
          'Error name': sets(new Error('x'), 'name'),
          'TypeError message': sets(new E('x'), 'message'),
          'Array push': sets([], 'push'),
          'Array map': sets([], 'map'),
          'Map get': sets(new Map(), 'get'),
          'TypedArray toString (subclass prototype)': sets(B.prototype, 'toString'),
        },
        // The protected properties: overriding them on an instance throws.
        notOverridable: {
          'Array Symbol.iterator': sets([], Symbol.iterator),
          'Array constructor': sets([], 'constructor'),
          'Map Symbol.iterator': sets(new Map(), Symbol.iterator),
          'Promise then': sets(Promise.resolve(), 'then'),
          'Promise constructor': sets(Promise.resolve(), 'constructor'),
          'RegExp exec': sets(/x/, 'exec'),
          'String toString (a String object)': sets(new String('x'), 'toString'),
        },
        dataProperties: {
          'Array.prototype[Symbol.iterator]': isData(Array.prototype, Symbol.iterator),
          '%TypedArray%.prototype[Symbol.iterator]': isData(
            Reflect.getPrototypeOf(Int8Array.prototype) ?? {},
            Symbol.iterator,
          ),
          '%IteratorPrototype%[Symbol.iterator]': isData(iteratorProto, Symbol.iterator),
          '%ArrayIteratorPrototype%.next': isData(
            Reflect.getPrototypeOf([][Symbol.iterator]()) ?? {},
            'next',
          ),
          'Map.prototype[Symbol.iterator]': isData(Map.prototype, Symbol.iterator),
          'Promise.prototype.then': isData(Promise.prototype, 'then'),
          'RegExp.prototype.exec': isData(RegExp.prototype, 'exec'),
          'String.prototype.toString': isData(String.prototype, 'toString'),
        },
        frozen: [
          Array.prototype,
          Object.prototype,
          Map.prototype,
          Promise.prototype,
          iteratorProto,
        ].every((o) => Object.isFrozen(o)),
      };
      const value = {
        cannotOverride: where(report.overridable, true),
        canOverride: where(report.notOverridable, false),
        accessorNotData: where(report.dataProperties, true),
        frozen: report.frozen,
      };
      void ctx.bus.publish({ name: 'hello' }, { value }).catch(() => {});
      return;
    }
    void ctx.bus.publish({ name: 'hello' }, { value: ctx.id }).catch(() => {});
  },
};
