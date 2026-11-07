import { version } from 'react';
import { version as domVersion } from 'react-dom';
import { expect, inject, test } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    major: number;
    writeUsage: boolean;
  }
}

// The vitest project resolves `react` and `react-dom` to one major
// (vitest.config.ts); a wrong alias would test the other major twice.
test('resolves the project’s React major', () => {
  expect(Number(version.split('.')[0])).toBe(inject('major'));
  expect(domVersion).toBe(version);
});
