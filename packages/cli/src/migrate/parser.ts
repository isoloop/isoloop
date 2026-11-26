/*
 * The parser behind `isoloop migrate` (ADR 0019, decision 10): our own
 * interface, so the parser can be swapped. Today it's `oxc-parser`; the
 * conformance tests in parser.test.ts are what any replacement must pass.
 *
 * A file parses to an ESTree tree (with TypeScript's `TS*` nodes) whose
 * `start` and `end` are UTF-16 offsets into the text, the same indexes as
 * `String.prototype.slice`. Steps read the tree and return text edits at
 * those offsets (edit.ts); nothing is printed back from the tree.
 */

/** A node of the tree. Fields other than `type`, `start` and `end` are the ESTree ones. */
export type Node = {
  readonly type: string;
  /** UTF-16 offset of the node's first character. */
  readonly start: number;
  /** UTF-16 offset just past the node's last character. */
  readonly end: number;
  readonly [field: string]: unknown;
};

/** A parsed file. */
export type SourceFile = {
  /** The path it was read from, which also picks the syntax (`.ts`, `.tsx`, `.js`, `.jsx`…). */
  readonly path: string;
  readonly text: string;
  /** The `Program` node. */
  readonly program: Node;
};

/** Why a file didn't parse. */
export type ParseError = { readonly message: string; readonly start: number; readonly end: number };

export type ParseResult =
  | { readonly ok: true; readonly file: SourceFile }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

/** Parses TypeScript, JavaScript and JSX, picked by the file's extension. */
export type Parser = { readonly parse: (path: string, text: string) => ParseResult };

/** The extensions a parser must handle, and the only files `isoloop migrate` reads. */
export const EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];

/** A value is a node when it's an object with a string `type` and numeric offsets. */
export function isNode(value: unknown): value is Node {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'type') === 'string' &&
    typeof Reflect.get(value, 'start') === 'number' &&
    typeof Reflect.get(value, 'end') === 'number'
  );
}

/** `node[field]` when it's a node. */
export function child(node: Node, field: string): Node | undefined {
  const v = node[field];
  return isNode(v) ? v : undefined;
}

/** `node[field]` when it's a list: its nodes, in order (holes and non-nodes left out). */
export function children(node: Node, field: string): Node[] {
  const v = node[field];
  return Array.isArray(v) ? v.filter(isNode) : [];
}

/**
 * Visits `root` and every node under it, parents first and children in
 * source order. `parent` is `undefined` for `root`.
 */
export function walk(root: Node, visit: (node: Node, parent: Node | undefined) => void): void {
  const stack: { node: Node; parent: Node | undefined }[] = [{ node: root, parent: undefined }];
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    visit(top.node, top.parent);
    const kids: Node[] = [];
    for (const [key, value] of Object.entries(top.node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue;
      if (isNode(value)) kids.push(value);
      else if (Array.isArray(value)) for (const v of value) if (isNode(v)) kids.push(v);
    }
    kids.sort((a, b) => a.start - b.start);
    for (let i = kids.length - 1; i >= 0; i--) {
      const node = kids[i];
      if (node !== undefined) stack.push({ node, parent: top.node });
    }
  }
}

/** The oxc parser behind {@link Parser}. Loaded on first use, so other commands never load it. */
export async function loadParser(): Promise<Parser> {
  const oxc = await import('oxc-parser');
  return {
    parse(path, text) {
      const r = oxc.parseSync(path, text);
      if (r.errors.length > 0) {
        return {
          ok: false,
          errors: r.errors.map((e) => ({
            message: e.message,
            start: e.labels[0]?.start ?? 0,
            end: e.labels[0]?.end ?? 0,
          })),
        };
      }
      const program: unknown = r.program;
      if (!isNode(program)) throw new Error(`oxc-parser gave no program for ${path}`);
      return { ok: true, file: { path, text, program } };
    },
  };
}
