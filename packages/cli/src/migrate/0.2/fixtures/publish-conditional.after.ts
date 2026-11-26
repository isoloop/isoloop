import { defineIsolate } from '@isoloop/runtime';
import { prices } from './contracts';

// A second argument that picks between two records.
export default defineIsolate((ctx) => {
  const feed = (key: string | undefined, value: number, rec: { value: number }) => {
    void ctx.bus.publish(prices, value, key === undefined ? {} : { key });
    void ctx.bus.publish(prices, value, key ? { key: key.trim() } : {});
    // isoloop-migrate: publish takes (topic, value, { key }) since 0.2; check this call by hand
    void ctx.bus.publish(prices, key === undefined ? { value } : { key, value: value + 1 });
    // isoloop-migrate: publish takes (topic, value, { key }) since 0.2; check this call by hand
    void ctx.bus.publish(prices, key === undefined ? { value } : rec);
    // isoloop-migrate: publish takes (topic, value, { key }) since 0.2; check this call by hand
    void ctx.bus.publish(prices, key === undefined ? { value } : { key, value, unit: 'ms' });
    void ctx.bus.publish(prices, key === undefined ? value : value + 1);
  };
  return feed;
});
