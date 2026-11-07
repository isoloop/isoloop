import { deserialize, serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { expect, it } from 'vitest';

/**
 * Codec evaluation in Node (M2b task 2, docs/investigations/codec.md): speed,
 * size and bundle size of our codec against MessagePack and CBOR libraries,
 * JSON and V8's structured-clone serializer. `pnpm bench:codec` runs the
 * speed part in Chromium, Firefox and WebKit. Report only.
 *
 * The libraries' native Node add-ons stay off: the bus runs in browsers,
 * where only their JavaScript paths exist.
 */
process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED = 'true';
process.env.CBOR_NATIVE_ACCELERATION_DISABLED = 'true';
const { codecs, run } = await import('./codecs');

it('speed and size', () => {
  const all = [
    ...codecs,
    {
      name: 'structured clone (v8)',
      encode: (v: unknown) => serialize(v),
      decode: (b: Uint8Array): unknown => deserialize(b),
    },
  ];
  process.stdout.write(`${run(all, (a, b) => expect(a).toEqual(b))}\n`);
});

it('bundle size, minified and gzipped', async () => {
  const entries: [string, string][] = [
    ['@isoloop/codec', "export { encode, decode } from '@isoloop/codec';"],
    ['@msgpack/msgpack', "export { encode, decode } from '@msgpack/msgpack';"],
    ['msgpackr', "export { pack, unpack } from 'msgpackr';"],
    ['cbor-x', "export { encode, decode } from 'cbor-x';"],
  ];
  const id = '\0entry.js';
  const lines = ['\nbundle (browser build, minified)'];
  for (const [name, code] of entries) {
    // One build at a time: they share the plugin's virtual entry.
    // oxlint-disable-next-line no-await-in-loop
    const out = await build({
      logLevel: 'silent',
      configFile: false,
      root: import.meta.dirname,
      resolve: { conditions: ['@isoloop/source', 'browser', 'module', 'import', 'default'] },
      plugins: [
        {
          name: 'entry',
          resolveId: (s) => (s.endsWith('entry') ? id : undefined),
          load: (s) => (s === id ? code : undefined),
        },
      ],
      build: {
        write: false,
        minify: true,
        lib: { entry: 'entry', formats: ['es'], fileName: 'out' },
      },
    });
    const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) =>
      'output' in o ? o.output : [],
    );
    const js = outputs.map((o) => ('code' in o ? o.code : '')).join('');
    expect(js.length).toBeGreaterThan(0);
    lines.push(
      `${name.padEnd(24)}${js.length.toLocaleString('en').padStart(8)} B ${gzipSync(js).length.toLocaleString('en').padStart(8)} B gz`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
});
