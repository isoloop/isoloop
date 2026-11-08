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
    void ctx.bus.publish({ name: 'hello' }, { value: ctx.id }).catch(() => {});
  },
};
