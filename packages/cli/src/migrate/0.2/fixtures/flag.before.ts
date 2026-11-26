import { defineIsolate } from '@isoloop/runtime';
import { count, prices, wrapped } from './contracts';

// Calls 0.2 can't rewrite safely: each gets a comment to check by hand.
export default defineIsolate((ctx) => {
  const base = { key: 'a' };
  void ctx.bus.publish(prices, { ...base, value: 1 });
  void ctx.bus.publish(count, { value: 1, unit: 'ms' });
  const rec = { value: 1 };
  void ctx.bus.publish(count, rec);
  void ctx.bus.publish(wrapped, { value: { value: 1 } });
  const args = [count, { value: 1 }] as const;
  void ctx.bus.publish(...args);
});

// A record from elsewhere looks like a 0.2 value, so it's left alone.
export function forward(ctx: { bus: { publish: (...a: unknown[]) => Promise<void> } }, record: unknown) {
  return ctx.bus.publish(count, record);
}
