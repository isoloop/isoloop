import { defineIsolate } from '@isoloop/runtime';
import { prices } from './contracts';

// A second argument that picks between two records.
export default defineIsolate((ctx) => {
  const feed = (key: string | undefined, value: number, rec: { value: number }) => {
    void ctx.bus.publish(prices, key === undefined ? { value } : { key, value });
    void ctx.bus.publish(prices, key ? { value, key: key.trim() } : { value });
    void ctx.bus.publish(prices, key === undefined ? { value } : { key, value: value + 1 });
    void ctx.bus.publish(prices, key === undefined ? { value } : rec);
    void ctx.bus.publish(prices, key === undefined ? { value } : { key, value, unit: 'ms' });
    void ctx.bus.publish(prices, key === undefined ? value : value + 1);
  };
  return feed;
});
