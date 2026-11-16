// Test member for busy time (ADR 0017): headless. `config.via` picks how it
// schedules its work: a timer chain, an interval, animation frames, or
// messages on a `MessageChannel` it made. Each run spins for `config.burnMs`
// (0: a light member that still runs as often).
type Ctx = { config: unknown };

const spin = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // Busy on purpose.
  }
};

const field = (config: unknown, key: string): unknown =>
  typeof config === 'object' && config !== null ? Reflect.get(config, key) : undefined;

export default {
  start(ctx: Ctx): void {
    const via = field(ctx.config, 'via');
    const burn = Number(field(ctx.config, 'burnMs') ?? 0);
    const work = (): void => {
      spin(burn);
    };
    switch (via) {
      case 'timeout': {
        // A chain: each timer sets the next, so it stays this member's.
        const next = (): void => {
          work();
          setTimeout(next, 10);
        };
        setTimeout(next, 10);
        return;
      }
      case 'interval':
        setInterval(work, 10);
        return;
      case 'raf': {
        const frame = (): void => {
          work();
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        return;
      }
      case 'port': {
        const { port1, port2 } = new MessageChannel();
        // As React's scheduler does it.
        // oxlint-disable-next-line unicorn/prefer-add-event-listener -- `onmessage` is what is checked
        port1.onmessage = () => {
          work();
          setTimeout(() => port2.postMessage(null), 10);
        };
        port2.postMessage(null);
        return;
      }
      default:
    }
  },
};
