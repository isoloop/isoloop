/*
 * `isoloop contracts export <module>` (ADR 0003, decision 21): JSON Schema
 * (draft 2020-12) for every topic of a contracts module, through Standard JSON
 * Schema, with the same helpers the kernel uses for agent tools (ADR 0018).
 *
 * - Input and output are exported once as `schema` when they're the same,
 *   as `input` and `output` when they differ; `reply` likewise, as `reply` or
 *   `replyInput` and `replyOutput`.
 * - An `unchecked()` schema exports as `{}` and is listed under `unchecked`,
 *   with a warning on stderr.
 * - A schema without the interface, or one whose converter throws, isn't
 *   exportable: every such topic is reported on stderr, nothing is written,
 *   and the exit code is 1.
 */
import {
  JSON_SCHEMA_TARGET,
  isContracts,
  jsonSchemaOf,
  type AnyTopicDef,
  type JsonSchema,
  type ToolSpec,
} from '@isoloop/bus';
import { UsageError } from '../args';
import { EXIT, type Command } from '../command';
import { resolvePath } from '../io';

/** One topic in the exported document. */
export type ExportedTopic = {
  schema?: JsonSchema;
  input?: JsonSchema;
  output?: JsonSchema;
  reply?: JsonSchema;
  replyInput?: JsonSchema;
  replyOutput?: JsonSchema;
  /** The parts that came from `unchecked()`, exported as `{}`. */
  unchecked?: ('schema' | 'reply')[];
  tool?: ToolSpec;
};

/** The exported document. */
export type ExportedContracts = {
  target: typeof JSON_SCHEMA_TARGET;
  topics: { [name: string]: ExportedTopic };
};

/** What {@link exportContracts} gives: the document, or why it can't be made. */
export type ExportResult =
  | { ok: true; document: ExportedContracts; warnings: string[] }
  | { ok: false; errors: string[] };

/** JSON with object keys sorted, so two schemas compare by content. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Makes the export document for a contracts list's topics. Never throws. */
export function exportContracts(topics: readonly AnyTopicDef[]): ExportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const out: { [name: string]: ExportedTopic } = {};
  for (const def of topics) {
    const entry: ExportedTopic = {};
    const parts: ['schema' | 'reply', unknown][] = [['schema', def.schema]];
    if (def.reply !== undefined) parts.push(['reply', def.reply]);
    for (const [part, schema] of parts) {
      const r = jsonSchemaOf(schema);
      let input: JsonSchema;
      let output: JsonSchema;
      if (r.ok) {
        ({ input, output } = r);
      } else if (r.reason === 'unchecked') {
        input = {};
        output = {};
        (entry.unchecked ??= []).push(part);
        warnings.push(`${def.name}: ${part} is unchecked(), exported as {}`);
      } else {
        errors.push(`${def.name}: ${part} ${r.message}`);
        continue;
      }
      const same = canonical(input) === canonical(output);
      if (part === 'schema') {
        if (same) entry.schema = input;
        else Object.assign(entry, { input, output });
      } else if (same) {
        entry.reply = input;
      } else {
        Object.assign(entry, { replyInput: input, replyOutput: output });
      }
    }
    if (def.tool !== undefined) entry.tool = { ...def.tool };
    out[def.name] = entry;
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, document: { target: JSON_SCHEMA_TARGET, topics: out }, warnings };
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const contractsExport: Command = {
  path: ['contracts', 'export'],
  summary: 'Write JSON Schema for every topic in a contracts module',
  usage: '<module>',
  details: [
    '<module> is the contracts module: its default export is made by contracts().',
    'Prints the JSON document, or writes it with --out.',
    "Exits 1 when a topic's schema can't be made into JSON Schema.",
  ].join('\n'),
  flags: {
    out: {
      type: 'string',
      short: 'o',
      value: 'file',
      description: 'Write to a file instead of stdout',
    },
    help: { type: 'boolean', short: 'h', description: 'Show this help' },
  },
  async run(args, io) {
    const [module, ...extra] = args.positionals;
    if (module === undefined) throw new UsageError('missing <module>');
    if (extra.length > 0) throw new UsageError(`unexpected argument ${extra[0] ?? ''}`);
    const path = resolvePath(io, module);
    let loaded: unknown;
    try {
      loaded = await io.load(path);
    } catch (e) {
      io.err(`isoloop: can't load ${module}: ${messageOf(e)}\n`);
      return EXIT.failed;
    }
    const contracts: unknown =
      typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'default') : undefined;
    if (!isContracts(contracts)) {
      io.err(`isoloop: ${module} has no default export made by contracts()\n`);
      return EXIT.failed;
    }
    const result = exportContracts(contracts.topics);
    if (!result.ok) {
      io.err(`isoloop: not exportable:\n${result.errors.map((e) => `  ${e}\n`).join('')}`);
      return EXIT.failed;
    }
    for (const w of result.warnings) io.err(`isoloop: warning: ${w}\n`);
    const json = `${JSON.stringify(result.document, null, 2)}\n`;
    const file = args.flags['out'];
    if (typeof file === 'string') {
      await io.writeFile(resolvePath(io, file), json);
      const n = Object.keys(result.document.topics).length;
      io.err(`isoloop: wrote ${n} topic${n === 1 ? '' : 's'} to ${file}\n`);
    } else {
      io.out(json);
    }
    return EXIT.ok;
  },
};
