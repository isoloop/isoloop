// Test isolate: starts fine, then throws from a timer, outside any handler
// the runtime can catch: the worker's `error` event.
export default {
  start(): void {
    setTimeout(() => {
      throw new Error('timer threw');
    }, 300);
  },
};
