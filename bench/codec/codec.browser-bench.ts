import { expect, it } from 'vitest';
import { codecs, run } from './codecs';

// The codec evaluation's speed part in a browser (`pnpm bench:codec`, all
// three engines), where the bus actually runs it. Report only.
it('speed and size', () => {
  console.log(`[${navigator.userAgent}]\n${run(codecs, (a, b) => expect(a).toEqual(b))}`);
});
