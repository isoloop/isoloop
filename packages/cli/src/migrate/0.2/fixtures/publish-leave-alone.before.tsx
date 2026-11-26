import { usePublish } from '@isoloop/react';
import { defineIsolate } from '@isoloop/runtime';
import { EventEmitter } from './events';
import { count, price, prices } from './contracts';

// Calls 0.2 leaves as they are: already in the 0.2 shape, not `publish`,
// or another library's `publish`.
export default defineIsolate((ctx) => {
  void ctx.bus.publish(count, 1);
  void ctx.bus.publish(prices, 102, { key: 'AAPL' });
  void ctx.bus.publish(prices, { symbol: 'X', price: 1 });
  void ctx.bus.request(price, { value: 1 }, { key: 'X' });
  ctx.bus.subscribe(price, (r) => void ctx.bus.reply(r, { value: 2 }));
  const emitter = new EventEmitter();
  emitter.publish('tick', { value: 1 });
  ctx.bus['publish'](count, { value: 1 });
});

export function Button() {
  const send = usePublish(count);
  return <button onClick={() => void send(1, { key: 'a' })}>+1</button>;
}
