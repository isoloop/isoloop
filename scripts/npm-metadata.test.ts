// What npm shows and searches for each published package: a homepage on
// isoloop.dev and keywords. npm falls back to the GitHub README when a
// manifest has no homepage, so a missing one fails nothing else.
import { describe, expect, it } from 'vitest';
import { record } from './release/npm.ts';
import { publicPackages, workingTree } from './release/packages.ts';

describe('npm metadata', () => {
  for (const { dir, manifest } of publicPackages(workingTree)) {
    const parsed = record(JSON.parse(workingTree.read(`${dir}/package.json`) ?? '{}'));
    const area = dir.slice('packages/'.length);

    // A package with a page in docs/api links that page; the others, the site.
    it(`${manifest.name} links its page on isoloop.dev`, () => {
      const page = workingTree.read(`docs/api/${area}.md`) === undefined ? '' : `docs/api/${area}/`;
      expect(parsed['homepage']).toBe(`https://isoloop.dev/${page}`);
    });

    it(`${manifest.name} has keywords, isoloop first`, () => {
      expect(parsed['keywords']).toHaveProperty('0', 'isoloop');
    });
  }
});
