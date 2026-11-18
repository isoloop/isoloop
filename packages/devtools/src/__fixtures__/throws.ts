// Test isolate: throws during start, every time.
export default {
  start(): void {
    throw new Error('start threw');
  },
};
