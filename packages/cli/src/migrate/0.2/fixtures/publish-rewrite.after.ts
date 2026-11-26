import { createKernel } from '@isoloop/host';
import { defineIsolate } from '@isoloop/runtime';
import { contracts, count, prices } from './contracts';

// The 0.1 shapes 0.2 rewrites.
export default defineIsolate((ctx) => {
  void ctx.bus.publish(count, 1);
  void ctx.bus.publish(prices, 102, { key: 'AAPL' });
  const { bus } = ctx;
  const key = 'MSFT';
  const value = 250;
  void bus.publish(prices, value, { key });
  void ctx.bus.publish(prices, { symbol: 'X', price: 1 } satisfies Quote, { key: 'X' });
});

type Quote = { symbol: string; price: number };

export async function start(): Promise<void> {
  const app = await createKernel({ contracts });
  await app.publish(count, 0);
  await this_.kernel.publish(prices, 3, { key: `k${1}` });
  await app.kernel?.publish(count, (1 + 2) as number);
}

declare const this_: { kernel: { publish: (...a: unknown[]) => Promise<void> } };
