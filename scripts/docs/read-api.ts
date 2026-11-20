// What the published `.d.ts` exports, for the docs scripts (M4c, decision 32).
// This file is the only one that imports tsrs: `readApi` is our own seam over
// tsrs's copy of TypeScript's API (`tsrs/sync`, `tsrs/ast`), so moving to
// TypeScript 7.1's `typescript/sync` changes the imports here and nothing
// else. Its conformance suite is read-api.test.ts.
import {
  isClassDeclaration,
  isExpressionWithTypeArguments,
  isIdentifier,
  isInterfaceDeclaration,
  isPrivateIdentifier,
  isQualifiedName,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isTypeQueryNode,
  isTypeReferenceNode,
  isVariableDeclarationList,
  type Node,
} from 'tsrs/ast';
import { readFileSync } from 'node:fs';
import {
  API,
  ModuleKind,
  ModuleResolutionKind,
  SignatureKind,
  SymbolFlags,
  type Checker,
  type Program,
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
  /** Its declarations as the `.d.ts` has them (several for an overloaded function). */
  decls: readonly ApiDecl[];
};

/** One declaration's source, for the reference (decision 27). */
export type ApiDecl = {
  /** The declaration's text, without its doc comment. */
  text: string;
  /** Its doc comment, `/** … *\/` included, or `''`. */
  doc: string;
  /** For an interface, a class or a type alias of an object type: its named members, in order. */
  members: readonly ApiMember[];
};

/** A named member of an interface, a class or an object type. */
export type ApiMember = { name: string; text: string; doc: string };

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
  return withProgram(files, cwd, (program, checker, target) => {
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
        decls: r.sym.declarations.flatMap((d) => {
          const decl = declOf(d.resolve(), d.path);
          return decl ? [decl] : [];
        }),
      });
    }
    const syms = raw.map((r) => r.sym);
    return { entries, refs: references(checker, target, syms, exporters, files) };
  });
}

/** Opens one program over the entry points, runs `read`, and closes it. */
function withProgram<T>(
  files: readonly EntryFile[],
  cwd: string,
  read: (program: Program, checker: Checker, target: (s: Symbol) => Symbol) => T,
): T {
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
    return read(program, checker, target);
  } finally {
    api.close();
  }
}

const texts = new Map<string, string>();
const fileText = (path: string): string => {
  let t = texts.get(path);
  if (t === undefined) {
    t = readFileSync(path, 'utf8');
    texts.set(path, t);
  }
  return t;
};

/** The text and the doc comment of `n`: from after its last doc comment (or its start) to its end. */
function span(n: Node, text: string): { text: string; doc: string } {
  const doc = n.jsDoc?.at(-1);
  const from = doc ? doc.end : n.pos;
  return {
    text: text.slice(from, n.end).trim(),
    doc: doc ? text.slice(text.indexOf('/**', doc.pos), doc.end).trim() : '',
  };
}

/** The members of an interface, a class or a type alias of an object type. */
function membersOf(n: Node): readonly Node[] {
  if (isInterfaceDeclaration(n) || isClassDeclaration(n)) return n.members;
  if (isTypeAliasDeclaration(n) && isTypeLiteralNode(n.type)) return n.type.members;
  return [];
}

const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && 'kind' in v && typeof v.kind === 'number';

/** A member's name, when it has a plain one (not a computed one, nor a call or index signature). */
function nameOf(m: Node): string | undefined {
  const name = 'name' in m ? m.name : undefined;
  if (!isNode(name)) return undefined;
  return isIdentifier(name) || isStringLiteral(name) || isPrivateIdentifier(name)
    ? name.text
    : undefined;
}

/** A declaration's text, doc comment and members. A variable's are its statement's (`declare const …`). */
function declOf(n: Node | undefined, path: string): ApiDecl | undefined {
  if (!n) return undefined;
  const text = fileText(path);
  const statement = isVariableDeclarationList(n.parent) ? n.parent.parent : n;
  return {
    ...span(statement, text),
    members: membersOf(n).flatMap((m) => {
      const name = nameOf(m);
      return name === undefined ? [] : [{ name, ...span(m, text) }];
    }),
  };
}

/** A doc comment: its text, without tags, and its tags. */
export type DocComment = {
  doc: string;
  tags: readonly { name: string; text: string }[];
};

/** One signature: its parameters' names and whether it returns a value. */
export type DocSignature = { params: readonly string[]; returns: boolean };

/**
 * One exported declaration's TSDoc, for docs:check item 7 (M4c, decision 30).
 * Each declaration appears once, under its home entry point.
 */
export type DocExport = DocComment & {
  entry: string;
  name: string;
  kind: ExportKind;
  /** Call signatures (a function, a callable const); a class has none here. */
  signatures: readonly DocSignature[];
  /**
   * The properties of an interface, a type alias's object type or a class's
   * instances, declared in the packages read. `key` identifies the property's
   * declaration, so a field shared through `extends` is the same field.
   */
  members: readonly (DocComment & { name: string; key: string })[];
};

const VOID = new Set(['void', 'undefined', 'never', 'Promise<void>', 'Promise<undefined>']);

/** Reads the TSDoc of every exported declaration, `@internal` ones left out. */
export function readDocs(files: readonly EntryFile[], cwd: string): DocExport[] {
  return withProgram(files, cwd, (program, checker, target) => {
    const dirs = files.map((f) => packageDir(f.file));
    const comment = (s: Symbol): DocComment => ({
      doc: checker.getDocumentationCommentOfSymbol(s).trim(),
      tags: checker.getJsDocTagsOfSymbol(s).map((t) => ({ name: t.name, text: t.text ?? '' })),
    });
    const seen = new Set<string>();
    const out: DocExport[] = [];
    for (const f of files) {
      const sf = program.getSourceFile(f.file);
      if (!sf) throw new Error(`readDocs: ${f.file} isn't in the program`);
      const mod = checker.getSymbolAtLocation(sf);
      if (!mod) continue;
      const own = packageDir(f.file);
      for (const e of checker.getExportsOfModule(mod)) {
        const t = target(e);
        const key = keyOf(t);
        if (!key || seen.has(key)) continue;
        // A re-export is documented where it's declared, in its own package.
        if (!key.startsWith(own) && dirs.some((d) => key.startsWith(d))) continue;
        const c = comment(t);
        if (c.tags.some((x) => x.name === 'internal')) continue;
        seen.add(key);
        const kind = kindOf(t.flags);
        const signatures =
          kind === 'function' || kind === 'const'
            ? checker
                .getSignaturesOfType(checker.getTypeOfSymbol(t), SignatureKind.Call)
                .map((sig) => ({
                  params: sig.getParameters().map((p) => p.name),
                  returns: !VOID.has(checker.typeToString(checker.getReturnTypeOfSignature(sig))),
                }))
            : [];
        const members =
          kind === 'interface' || kind === 'type' || kind === 'class'
            ? checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(t)).flatMap((p) => {
                const k = keyOf(p);
                return k && dirs.some((d) => k.startsWith(d))
                  ? [{ name: p.name, key: k, ...comment(p) }]
                  : [];
              })
            : [];
        out.push({ entry: f.entry, name: e.name, kind, ...c, signatures, members });
      }
    }
    return out;
  });
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
