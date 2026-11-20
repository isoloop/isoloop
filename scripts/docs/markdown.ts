// Markdown helpers docs:check shares with the API check (scripts/ci/api-check.ts),
// which runs before `pnpm install` and so can't load ./check.ts's tsrs import.

export type Problem = { file: string; message: string };

/** The Markdown with fenced blocks blanked (line count kept), for prose-only checks. */
export function withoutFences(md: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of md.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && (m[1] ?? '').startsWith(fence)) fence = undefined;
      out.push('');
    } else if (m) {
      fence = (m[1] ?? '').slice(0, 3);
      out.push('');
    } else out.push(line);
  }
  return out.join('\n');
}

// docs:check item 5 (M4c, decision 22).
/**
 * Each inline code span in the guide's prose that names one of `removed`
 * (`createKernel`, `kernel.request(…)`, `Kernel`), with its line. Fences are
 * item 2's: a removed name there fails the type check. The removed names come
 * from the API check (`scripts/ci/api-check.ts`), the one job that builds the
 * PR's base, so this item runs there.
 */
export function checkRemovedNames(
  file: string,
  md: string,
  removed: ReadonlySet<string>,
): Problem[] {
  if (removed.size === 0) return [];
  const out: Problem[] = [];
  withoutFences(md)
    .split('\n')
    .forEach((line, i) => {
      for (const span of line.matchAll(/`([^`]+)`/g)) {
        for (const id of (span[1] ?? '').match(/[A-Za-z_$][\w$]*/g) ?? []) {
          if (removed.has(id))
            out.push({
              file: `${file}:${i + 1}`,
              message: `names \`${id}\`, which is no longer exported: update the guide`,
            });
        }
      }
    });
  return out;
}
