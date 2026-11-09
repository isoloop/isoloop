// Test pool member (M2c): headless. Publishes its own id on its own bus port,
// so a test can tell which member reached which port; throws in start() when
// its config asks for it.
type Ctx = {
  id: string;
  config: unknown;
  bus: { publish(topic: { name: string }, rec: { value: unknown }): Promise<void> };
  onShutdown(fn: () => void): void;
};

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
    void ctx.bus.publish({ name: 'hello' }, { value: ctx.id }).catch(() => {});
  },
};
