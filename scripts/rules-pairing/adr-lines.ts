// The ADR side of isoloop's Rules workflow (ADR 0026, decision 11): which
// rules an ADR's `Rules:` lines name, and which of its decisions and
// amendments have no `Rules:` line. Copied from Archeion's registry module
// (sabbz-dev/archeion, src/registry.ts) when the rules tool moved there, so
// this check needs no install; keep the two in step.

/** Heading text as shown: inline code, links and emphasis reduced to their text. */
export function headingText(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*)(.*?)\1/g, '$2')
    .trim();
}

/** The lines of a Markdown file outside code fences, with their index. */
function outsideFences(md: string): { i: number; line: string }[] {
  const out: { i: number; line: string }[] = [];
  let fence: string | undefined;
  md.split('\n').forEach((line, i) => {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (fence === undefined) fence = f[1]!.slice(0, 3);
      else if (f[1]!.startsWith(fence)) fence = undefined;
      return;
    }
    if (fence === undefined) out.push({ i, line });
  });
  return out;
}

const RULES_LINE = /^\s*Rules:(.*)$/;

/** The ids on an ADR's `Rules:` lines (decision 9): backticked, comma-separated, outside fences. */
export function readRulesLines(md: string): string[] {
  const ids: string[] = [];
  for (const { line } of outsideFences(md)) {
    const m = RULES_LINE.exec(line);
    if (m) for (const id of m[1]!.matchAll(/`([^`]+)`/g)) ids.push(id[1]!);
  }
  return ids;
}

/**
 * The decisions and amendments in an ADR that have no `Rules:` line.
 * - A decision, under the `## Decision` heading, is a numbered `###` heading
 *   (`### 1. …`, ADR 0007's style) when there are any; otherwise a top-level
 *   numbered item (`12. …` at column 0, ADR 0026's style), up to the next such
 *   item or heading; otherwise each `###` section.
 * - An amendment is any heading whose text says "amended", up to the next
 *   heading of the same or a higher level.
 */
export function unruledSections(md: string): string[] {
  const lines = outsideFences(md);
  type Unit = { name: string; level: number; isHeading: boolean; ruled: boolean };
  const units: Unit[] = [];
  const itemUnits: Unit[] = [];
  const open: Unit[] = [];
  let inDecision = false;
  let decisionLevel = 0;
  const h3s: Unit[] = [];
  const close = (level: number, item: boolean) => {
    for (let k = open.length - 1; k >= 0; k--) {
      const u = open[k]!;
      if (item ? !u.isHeading : u.level >= level) open.splice(k, 1);
    }
  };
  for (const { line } of lines) {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const text = headingText(h[2]!);
      close(level, false);
      close(0, true); // a heading ends any numbered item
      if (inDecision && level <= decisionLevel) inDecision = false;
      if (level === 2 && /^decision\b/i.test(text)) {
        inDecision = true;
        decisionLevel = 2;
      }
      if (/amended/i.test(text)) {
        const u = { name: `amendment "${text}"`, level, isHeading: true, ruled: false };
        units.push(u);
        open.push(u);
      } else if (inDecision && level === 3) {
        const num = /^(\d+)\.\s/.exec(text);
        const name = num ? `decision ${num[1]}` : `section "${text}"`;
        const u = { name, level, isHeading: true, ruled: false };
        h3s.push(u);
        open.push(u);
      }
      continue;
    }
    const n = /^(\d+)\.\s/.exec(line);
    if (inDecision && n) {
      close(0, true);
      const u = { name: `decision ${n[1]}`, level: 99, isHeading: false, ruled: false };
      itemUnits.push(u);
      open.push(u);
      continue;
    }
    if (RULES_LINE.test(line)) for (const u of open) u.ruled = true;
  }
  const numbered = h3s.filter((u) => u.name.startsWith('decision '));
  if (numbered.length > 0) units.push(...numbered);
  else if (itemUnits.length > 0) units.push(...itemUnits);
  else units.push(...h3s);
  return units.filter((u) => !u.ruled).map((u) => u.name);
}
