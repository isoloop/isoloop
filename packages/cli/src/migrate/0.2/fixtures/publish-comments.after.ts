import { defineIsolate } from '@isoloop/runtime';
import { prices } from './contracts';

// Comments in the removed record move with what they describe: the key's
// into the options, the value's beside the value, any other above the call.
export default defineIsolate((ctx) => {
  void ctx.bus.publish(
    prices,
    // the price, in cents
    102,
    {
      key: 'AAPL', // the symbol
    },
  );
  // sent every second
  void ctx.bus.publish(
    prices,
    { symbol: 'X', price: 1 }, // the quote
    {
      // which feed
      key: 'X',
    },
  );
  void ctx.bus.publish(prices, {
    // inside the value
    price: 1,
  });
  void ctx.bus.publish(prices, 1 /* one */, { /* the symbol */ key: 'X' });
});
