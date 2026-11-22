// What the public npm registry says, read without credentials.
import type { Registry } from './rules.ts';

export const REGISTRY = 'https://registry.npmjs.org';

export const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? { ...v } : {};

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The public registry's answers, as a seam for the tests. */
export interface Npm {
  packument(name: string): Promise<unknown>;
  /** `undefined` when the version has no attestations. */
  attestations(name: string, version: string): Promise<unknown>;
}

export const npm: Npm = {
  async packument(name) {
    const response = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json', 'cache-control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`npm answered ${response.status} for ${name}`);
    const body: unknown = await response.json();
    return body;
  },
  async attestations(name, version) {
    const id = `${name.replace('/', '%2f')}@${version}`;
    const response = await fetch(`${REGISTRY}/-/npm/v1/attestations/${id}`);
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`npm answered ${response.status} for ${id}'s attestations`);
    const body: unknown = await response.json();
    return body;
  },
};

/** A packument's dist-tags and versions. */
export function registryOf(packument: unknown, name: string): Registry {
  const doc = record(packument);
  if (!('dist-tags' in doc) || !('versions' in doc)) {
    throw new Error(`npm's answer for ${name} has no dist-tags and versions`);
  }
  const tags: Record<string, string> = {};
  for (const [tag, version] of Object.entries(record(doc['dist-tags']))) tags[tag] = text(version);
  return { tags, versions: Object.keys(record(doc['versions'])) };
}
