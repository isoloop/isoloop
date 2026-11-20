// What the published `.d.ts` exports, for the docs scripts (M4c, decision 32).
// This file is the only one that imports tsrs: `readApi` is our own seam over
// tsrs's copy of TypeScript's API (`tsrs/sync`, `tsrs/ast`), so moving to
// TypeScript 7.1's `typescript/sync` changes the imports here and nothing
// else. Its conformance suite is read-api.test.ts.
import {
  isExpressionWithTypeArguments,
  isQualifiedName,
  isTypeQueryNode,
  isTypeReferenceNode,
  type Node,
} from 'tsrs/ast';
import {
  API,
  ModuleKind,
  ModuleResolutionKind,
  SymbolFlags,
  type Checker,
  type Symbol,
} from 'tsrs/sync';

/** One entry point to read: its import specifier and its `.d.ts`. */
export type EntryFile = { entry: string; file: string };

export type ExportKind =
  | 'function'
  | 'const'
  | 'class'
  | 'enum'
  | 'namespace'
  | 'interface'
  | 'type';

/** One exported name of one entry point. */
export type ApiExport = {
  name: string;
  kind: ExportKind;
  /** The declaration it resolves to, the same for every re-export of it (decision 33). */
  key: string;
  /** The entry point that owns the declaration (decision 33). */
  home: string;
  tags: readonly { name: string; text: string }[];
  /** Whether the declaration has a doc comment. */
  documented: boolean;
};

export type ApiModel = {
  /** Each entry point's exports, `@internal` ones left out, in the order given. */
  entries: ReadonlyMap<string, readonly ApiExport[]>;
  /**
   * For each declaration reached from an export: the declarations its own text
   * names (parameter, return and field types, heritage, `typeof`). Keys are
   * `ApiExport.key`s; declarations that aren't exported appear too.
   */
  refs: ReadonlyMap<string, readonly string[]>;
};

/** The kind of a symbol's flags; a value merged with a type counts as the value. */
export function kindOf(flags: number): ExportKind {
  if (flags & SymbolFlags.Function) return 'function';
  if (flags & SymbolFlags.Class) return 'class';
  if (flags & SymbolFlags.Enum) return 'enum';
  if (flags & SymbolFlags.Variable) return 'const';
  if (flags & SymbolFlags.Interface) return 'interface';
  if (flags & SymbolFlags.TypeAlias) return 'type';
  return 'namespace';
}

/** Whether exports of this kind count as covered when a covered export refers to them (decision 41). */
export const isTypeKind = (k: ExportKind): boolean => k === 'interface' || k === 'type';

/** The declaration a symbol stands for: its first declaration, as `path#index`. */
const keyOf = (s: Symbol): string | undefined => {
  const d = s.declarations[0];
  return d ? `${d.path}#${d.index}` : undefined;
};

/** The package folder (`…/packages/host/`) of a `dist/*.d.ts` file. */
const packageDir = (file: string): string => {
  const at = file.lastIndexOf('/dist/');
  return at < 0 ? file.slice(0, file.lastIndexOf('/') + 1) : file.slice(0, at + 1);
};

/** The name a type position refers to: `A` in `A<T>`, `C` in `A.B.C`, `X` in `typeof X`. */
function referencedName(n: Node): Node | undefined {
  const name = isTypeReferenceNode(n)
    ? n.typeName
    : isTypeQueryNode(n)
      ? n.exprName
      : isExpressionWithTypeArguments(n)
        ? n.expression
        : undefined;
  return name && isQualifiedName(name) ? name.right : name;
}

/**
 * Reads the exports of each entry point. A declaration's home is the first
 * entry point of its own package that exports it, or else (a type from a
 * package that isn't read, such as `@isoloop/protocol`) the first entry point
 * that exports it, in the order given.
 */
export function readApi(files: readonly EntryFile[], cwd: string): ApiModel {
  const api = new API({ cwd });
  try {
    const program = api.createProgram(
      files.map((f) => f.file),
      {
        module: ModuleKind.NodeNext,
        moduleResolution: ModuleResolutionKind.NodeNext,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
      },
    );
    const checker = program.getProject().checker;
    const target = (s: Symbol): Symbol =>
      s.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s;

    const raw: { entry: string; name: string; sym: Symbol; key: string }[] = [];
    const exporters = new Map<string, string[]>();
    for (const f of files) {
      const sf = program.getSourceFile(f.file);
      if (!sf) throw new Error(`readApi: ${f.file} isn't in the program`);
      const mod = checker.getSymbolAtLocation(sf);
      if (!mod) continue; // a .d.ts that exports nothing
      for (const e of checker.getExportsOfModule(mod)) {
        const t = target(e);
        const key = keyOf(t);
        if (!key) continue;
        if (checker.getJsDocTagsOfSymbol(t).some((x) => x.name === 'internal')) continue;
        raw.push({ entry: f.entry, name: e.name, sym: t, key });
        exporters.set(key, [...(exporters.get(key) ?? []), f.entry]);
      }
    }
    const dirOf = new Map(files.map((f) => [f.entry, packageDir(f.file)]));
    const homeOf = (key: string): string => {
      const by = exporters.get(key) ?? [];
      return by.find((e) => key.startsWith(dirOf.get(e) ?? '\0')) ?? by[0] ?? '';
    };

    const entries = new Map<string, ApiExport[]>(files.map((f) => [f.entry, []]));
    for (const r of raw) {
      entries.get(r.entry)?.push({
        name: r.name,
        kind: kindOf(r.sym.flags),
        key: r.key,
        home: homeOf(r.key),
        tags: checker
          .getJsDocTagsOfSymbol(r.sym)
          .map((t) => ({ name: t.name, text: t.text ?? '' })),
        documented: checker.getDocumentationCommentOfSymbol(r.sym).trim() !== '',
      });
    }
    const syms = raw.map((r) => r.sym);
    return { entries, refs: references(checker, target, syms, exporters, files) };
  } finally {
    api.close();
  }
}

/** The references graph, from every exported declaration outwards, within the packages read. */
function references(
  checker: Checker,
  target: (s: Symbol) => Symbol,
  from: readonly Symbol[],
  exporters: ReadonlyMap<string, readonly string[]>,
  files: readonly EntryFile[],
): Map<string, string[]> {
  const dirs = files.map((f) => packageDir(f.file));
  const ours = (key: string): boolean => exporters.has(key) || dirs.some((d) => key.startsWith(d));
  const refs = new Map<string, string[]>();
  const queue = [...from];
  for (let s = queue.pop(); s; s = queue.pop()) {
    const key = keyOf(s);
    if (!key || refs.has(key)) continue;
    const out = new Set<string>();
    refs.set(key, []);
    const visit = (n: Node): undefined => {
      const name = referencedName(n);
      const hit = name ? checker.getSymbolAtLocation(name) : undefined;
      if (hit) {
        const t = target(hit);
        const k = keyOf(t);
        if (k && k !== key && ours(k)) {
          out.add(k);
          queue.push(t);
        }
      }
      n.forEachChild(visit);
      return undefined;
    };
    for (const d of s.declarations) {
      const node = d.resolve();
      if (node) visit(node);
    }
    refs.set(key, [...out]);
  }
  return refs;
}
