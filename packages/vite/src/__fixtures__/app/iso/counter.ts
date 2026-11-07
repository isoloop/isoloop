// A stand-in isolate module for the build tests: its default export must survive.
export default {
  start(): void {
    console.log('counter');
  },
};
