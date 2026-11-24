// Test isolate: runs and beats for 1.5 s after each start, then loops forever,
// so a crash loop is slower than a short restart window (#390).
export default {
  start(): void {
    setTimeout(() => {
      for (;;) {
        // Never yields.
      }
    }, 1500);
  },
};
