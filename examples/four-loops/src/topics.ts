// Topic handles for isolate code. The bus validates every record (ADR 0003,
// decision 10), so isolates need only a topic's name and its types: these
// handles import the contracts' types, not Zod, which keeps the schema
// library out of every isolate worker.
import type * as C from './contracts';

/** A handle that carries `T`'s types and only the name at runtime. */
function handle<T extends { name: string }>(name: T['name']): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the bus client reads only `name`; the types come from the contracts
  return { name, schema: { '~standard': {} } } as unknown as T;
}

export const count: typeof C.count = handle('count.v1');
export const note: typeof C.note = handle('note.v1');
export const primes: typeof C.primes = handle('primes.v1');
