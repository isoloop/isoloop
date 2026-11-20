// `docs:check` item 7 (M4c, decision 30; `docs/writing.md` § TSDoc): the
// TSDoc of the published `.d.ts`, which the API reference is generated from.
// It reads each user-facing declaration once, through `readDocs`, and fails on:
//
// 1. a function, class or const without a lead; a function, or a const you
//    call, without `@param` for each parameter, or without `@returns` when it
//    returns something;
// 2. a field of an options or config type (a name ending in `Options` or
//    `Config`) without its own comment;
// 3. a main entry point without an `@example`; the examples type-check like
//    the guides' fences (./fences.ts);
// 4. an ADR, a plan, a milestone or a decision number named anywhere in public
//    TSDoc: the reference says how it works, not why it was decided.
//
// Left to the steward, since the `.d.ts` can't show them: `@throws` naming the
// codes a function throws, a field's default, and a class constructor's
// `@param`s.
import { join } from 'node:path';
import { checkFences } from './fences.ts';
import type { Problem } from './markdown.ts';
import type { DocComment, DocExport } from './read-api.ts';

/** The entry points that carry an `@example` (decision 30): home entry, export, member. */
export const EXAMPLES: readonly { entry: string; name: string; member?: string }[] = [
  { entry: '@isoloop/host', name: 'createKernel' },
  { entry: '@isoloop/host', name: 'Kernel', member: 'request' },
  { entry: '@isoloop/runtime', name: 'defineIsolate' },
  { entry: '@isoloop/react', name: 'defineIsolate' },
  { entry: '@isoloop/preact', name: 'defineIsolate' },
  { entry: '@isoloop/bus', name: 'topic' },
  { entry: '@isoloop/bus', name: 'contracts' },
  { entry: '@isoloop/vite', name: 'isoloop' },
  { entry: '@isoloop/devtools', name: 'connectDevtools' },
  { entry: '@isoloop/webmcp', name: 'connectWebMCP' },
  { entry: '@isoloop/balancer', name: 'createBalancer' },
];

/** Names an ADR, a plan, a milestone (`M3h`) or a decision number. */
const HISTORY: readonly RegExp[] = [
  /\bADRs?[\s-]*\d{1,4}\b/,
  /\bdocs\/(?:adr|plans)\//,
  /\bM\d{1,2}[a-z]?\b/,
  /\bdecisions?\s+\d/i,
];

const OPTIONS = /(?:Options|Config)$/;

/** One `@example`, ready to type-check: where it's from and its code. */
export type Example = { label: string; lang: 'ts' | 'tsx'; code: string };

const label = (x: { entry: string; name: string }, member?: string): string =>
  `${x.entry} ${x.name}${member ? `.${member}` : ''}`;

/** The `@param` names a comment documents (`name - text` or `name text`). */
const paramNames = (c: DocComment): string[] =>
  c.tags.filter((t) => t.name === 'param').map((t) => /^\s*([\w$.[\]]+)/.exec(t.text)?.[1] ?? '');

/** Items 1, 2 and 4 on one declaration. */
function checkOne(x: DocExport): string[] {
  const out: string[] = [];
  const callable = x.signatures.length > 0;
  if ((x.kind === 'function' || x.kind === 'class' || x.kind === 'const') && x.doc === '')
    out.push(`\`${x.name}\` has no lead sentence`);
  if (callable) {
    const documented = new Set(paramNames(x));
    const count = paramNames(x).length;
    const missing = new Set<string>();
    for (const sig of x.signatures)
      sig.params.forEach((p, i) => {
        // A destructured parameter has no name of its own (`__0`): any @param in its place counts.
        const ok = /^__\d+$/.test(p) ? count > i : documented.has(p);
        if (!ok) missing.add(p);
      });
    if (missing.size > 0)
      out.push(`\`${x.name}\` has no @param for ${[...missing].map((p) => `\`${p}\``).join(', ')}`);
    if (x.signatures.some((s) => s.returns) && !x.tags.some((t) => t.name === 'returns'))
      out.push(`\`${x.name}\` returns a value but has no @returns`);
  }
  if (OPTIONS.test(x.name))
    for (const m of x.members)
      if (m.doc === '') out.push(`\`${x.name}.${m.name}\` has no comment of its own`);
  return out;
}

/** Item 4 on a comment: the first history reference it makes, if any. */
export function historyIn(c: DocComment): string | undefined {
  for (const text of [c.doc, ...c.tags.map((t) => t.text)])
    for (const re of HISTORY) {
      const m = re.exec(text);
      if (m) return m[0];
    }
  return undefined;
}

/** The code of an `@example`: its `ts`/`tsx` fences, or the whole text when it has none. */
export function exampleCode(text: string): { lang: 'ts' | 'tsx'; code: string }[] {
  const fences = [...text.matchAll(/```(tsx?)[^\n]*\n([\s\S]*?)```/g)].map((m) => ({
    lang: m[1] === 'tsx' ? ('tsx' as const) : ('ts' as const),
    code: (m[2] ?? '').trimEnd(),
  }));
  if (fences.length > 0) return fences;
  return text.includes('```') || text.trim() === '' ? [] : [{ lang: 'ts', code: text.trim() }];
}

/** Items 1–4, except type-checking the examples: the problems, and the examples to check. */
export function checkTsdoc(docs: readonly DocExport[]): {
  problems: Problem[];
  examples: Example[];
} {
  const problems: Problem[] = [];
  const fail = (entry: string, message: string): void => {
    problems.push({ file: entry, message });
  };
  const fields = new Set<string>();
  for (const x of docs) {
    // A field shared through `extends` is reported once, on the first type that has it.
    const own = { ...x, members: x.members.filter((m) => !fields.has(m.key)) };
    if (OPTIONS.test(x.name)) for (const m of x.members) fields.add(m.key);
    for (const m of checkOne(own)) fail(x.entry, m);
    const where = historyIn(x);
    if (where)
      fail(x.entry, `\`${x.name}\` names "${where}": say how it works, not why it was decided`);
    for (const m of own.members) {
      const at = historyIn(m);
      if (at)
        fail(
          x.entry,
          `\`${x.name}.${m.name}\` names "${at}": say how it works, not why it was decided`,
        );
    }
  }
  const examples: Example[] = [];
  for (const want of EXAMPLES) {
    const x = docs.find((d) => d.entry === want.entry && d.name === want.name);
    const where = label(want, want.member);
    const c = want.member ? x?.members.find((m) => m.name === want.member) : x;
    if (!c) {
      fail(
        want.entry,
        `\`${where}\` isn't in the published types, so its @example can't be checked`,
      );
      continue;
    }
    const code = c.tags.filter((t) => t.name === 'example').flatMap((t) => exampleCode(t.text));
    if (code.length === 0) fail(want.entry, `\`${where}\` has no @example with code`);
    for (const e of code) examples.push({ label: where, ...e });
  }
  return { problems, examples };
}

/** Item 3's type-check: each example as a fence next to the fence app, one `tsc` run. */
export function checkExamples(root: string, examples: readonly Example[]): Problem[] {
  const byFile = new Map<string, string>();
  const docs = examples.map((e, i) => {
    const file = `tsdoc/example-${i}.md`;
    byFile.set(file, e.label);
    return { file, md: `\`\`\`${e.lang}\n${e.code}\n\`\`\`\n` };
  });
  return checkFences(root, docs, join(root, 'node_modules/.cache/docs-examples')).map((p) => {
    const file = p.file.replace(/:\d+$/, '');
    const at = byFile.get(file);
    return at
      ? {
          file: at.split(' ')[0] ?? at,
          message: `\`${at}\` @example: ${p.message.replace("fence doesn't type-check: ", "doesn't type-check: ")}`,
        }
      : p;
  });
}
