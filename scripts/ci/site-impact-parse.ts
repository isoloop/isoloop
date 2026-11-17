// Reads the "Site impact:" line of a PR description (isoloop/web ADR 0004,
// decision 3). Shared by the CI check (scripts/ci/site-impact.ts), the API
// check (scripts/ci/api-check.ts) and the agents' PR gate
// (scripts/agent/pr-gate.ts). isoloop/web has the same logic in .mjs.

export type SiteImpactValue = 'none' | 'update needed' | `done in web#${number}`;

export type SiteImpact = { ok: true; value: SiteImpactValue } | { ok: false; error: string };

const FORMS = '"Site impact: none", "Site impact: update needed" or "Site impact: done in web#<n>"';

/** Lines outside HTML comments and fenced code blocks. */
function proseLines(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) out.push(line);
  }
  return out;
}

/** "**Site impact:** none", "- Site impact: none" and "Site impact: none" all read the same. */
function plain(line: string): string {
  return line
    .replace(/[*_`]/g, '')
    .replace(/^\s*[-+>]\s+/, '')
    .trim();
}

export function parseSiteImpact(body: string): SiteImpact {
  const lines = proseLines(body)
    .map(plain)
    .filter((l) => /^site impact\s*:/i.test(l));
  if (lines.length === 0) {
    return {
      ok: false,
      error: `The description has no "Site impact:" line. End it with ${FORMS}.`,
    };
  }
  if (lines.length > 1) {
    return {
      ok: false,
      error: `The description has ${lines.length} "Site impact:" lines. Keep exactly one: ${FORMS}.`,
    };
  }
  const value = (lines[0] ?? '')
    .replace(/^site impact\s*:\s*/i, '')
    .replace(/[.\s]+$/, '')
    .toLowerCase();
  if (value === 'none' || value === 'update needed') return { ok: true, value };
  const done = /^done in (?:isoloop\/)?web\s*#(\d+)$/.exec(value);
  if (done) return { ok: true, value: `done in web#${Number(done[1])}` };
  return { ok: false, error: `"Site impact: ${value}" isn't one of ${FORMS}.` };
}
