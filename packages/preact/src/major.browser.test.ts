import pkg from 'preact/package.json';
import { expect, inject, test } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    major: number;
  }
}

// The vitest project resolves `preact` to one major (vitest.config.ts); a
// wrong alias would test the other major twice.
test('resolves the project’s Preact major', () => {
  expect(Number(pkg.version.split('.')[0])).toBe(inject('major'));
});
