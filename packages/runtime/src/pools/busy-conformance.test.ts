/*
 * The attribution wrappers keep the natives' behaviour (ADR 0017): ids,
 * cancelling, `this` and arguments, ordering, errors, names and lengths,
 * and `MessagePort` listeners. The worker compares both and lists any
 * difference.
 */
import { expect, it } from 'vitest';

it('the wrapped scheduling functions and port listeners behave as the natives', async () => {
  const worker = new Worker(
    new URL('../__fixtures__/busy-conformance.worker.ts', import.meta.url),
    {
      type: 'module',
    },
  );
  try {
    const out = await new Promise<{ failures: string[]; before: unknown }>((resolve, reject) => {
      worker.addEventListener(
        'message',
        (e: MessageEvent<{ failures: string[]; before: unknown }>) => {
          resolve(e.data);
        },
      );
      worker.addEventListener('error', (e) => {
        reject(new Error(e.message));
      });
    });
    expect(out.failures).toEqual([]);
  } finally {
    worker.terminate();
  }
}, 20_000);
