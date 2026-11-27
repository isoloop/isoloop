// `pnpm rules:ship <version> [--date YYYY-MM-DD]` (ADR 0026, decision 13), run
// in the version PR: every rule whose `target` is that version becomes active,
// with `since` set, a `shipped` event and no `target`. The event's date is the
// `v<version>` tag's when the tag exists (the backfill runs it for 0.1.0 and
// 0.1.1), `--date` when given, and today otherwise. Then the README is rebuilt
// and the changed files formatted.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderReadme } from './build.ts';
import {
  isVersion,
  README,
  readAdrs,
  readRegistry,
  type Registry,
  type Rule,
  rulesIn,
} from './registry.ts';

/** Ships `version` in place; returns the ids shipped, by file. */
export function ship(reg: Registry, version: string, date: string): Map<string, string[]> {
  const shipped = new Map<string, string[]>();
  for (const f of reg.files) {
    if (!Array.isArray(f.data)) continue;
    f.data = rulesIn(f.data).map((r) => {
      if (r.target !== version) return r;
      shipped.set(f.path, [...(shipped.get(f.path) ?? []), r.id]);
      return shippedRule(r, version, date);
    });
  }
  return shipped;
}

/** The rule as active from `version`, keeping the field order of the ADR's table. */
function shippedRule(r: Rule, version: string, date: string): Rule {
  const out: Rule = { id: r.id, statement: r.statement, status: 'active', events: [] };
  if (r.experimental !== undefined) out.experimental = r.experimental;
  if (r.values) out.values = r.values;
  if (r.knob) out.knob = r.knob;
  if (r.errors) out.errors = r.errors;
  if (r.code) out.code = r.code;
  out.since = version;
  if (r.related) out.related = r.related;
  if (r.supersededBy) out.supersededBy = r.supersededBy;
  if (r.aliases) out.aliases = r.aliases;
  // Re-set so `events` comes last when written.
  delete (out as Partial<Rule>).events;
  out.events = [
    ...r.events,
    { type: 'shipped', date, ref: `v${version}`, why: `First released in ${version}.` },
  ];
  return out;
}

function tagDate(root: string, tag: string): string | undefined {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%as', tag], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function main(): void {
  const root = resolve(import.meta.dirname, '../..');
  const args = process.argv.slice(2);
  const version = args.find((a) => !a.startsWith('--'));
  const dateAt = args.indexOf('--date');
  const given = dateAt >= 0 ? args[dateAt + 1] : undefined;
  if (!version || !isVersion(version)) {
    console.error('usage: pnpm rules:ship <version> [--date YYYY-MM-DD]');
    process.exitCode = 1;
    return;
  }
  const date = given ?? tagDate(root, `v${version}`) ?? new Date().toISOString().slice(0, 10);
  const reg = readRegistry(root);
  const shipped = ship(reg, version, date);
  const written: string[] = [];
  for (const f of reg.files) {
    if (!shipped.has(f.path)) continue;
    writeFileSync(join(root, f.path), `${JSON.stringify(f.data, null, 2)}\n`);
    written.push(f.path);
  }
  writeFileSync(join(root, README), renderReadme(reg, readAdrs(root)));
  const oxfmt = join(root, 'node_modules/.bin/oxfmt');
  if (written.length > 0 && existsSync(oxfmt))
    execFileSync(oxfmt, written, { cwd: root, stdio: 'inherit' });
  const n = [...shipped.values()].reduce((a, ids) => a + ids.length, 0);
  console.log(`rules:ship ${version}: ${n} rule(s) now active, dated ${date}`);
  for (const [file, ids] of shipped) console.log(`  ${file}: ${ids.join(', ')}`);
}

if (import.meta.main) main();
