// CI: the Rules workflow (.github/workflows/rules.yml, ADR 0026, decision 11).
// - A PR that changes an ADR must change docs/rules/ too, unless it's
//   labelled `no-rules` (an edit that changes no fact: a typo, a link). Until
//   the backfill is done, this applies only to ADRs with `Rules:` lines, on the
//   base or on the PR.
// - Every rule id and alias on the base must still be an id or alias on the
//   PR: a rule that stops holding changes status, it's never deleted. The
//   label doesn't skip this.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { ADR_DIR, NOT_RULE_FILES, readRulesLines, RULES_DIR } from './registry.ts';

export const SKIP_LABEL = 'no-rules';

/** A file's text on the merge base and on the PR, `undefined` where it doesn't exist. */
export type ReadPair = (path: string) => { base: string | undefined; head: string | undefined };

export type Decision = { ok: true; message: string } | { ok: false; errors: string[] };

const isAdr = (p: string) => new RegExp(`^${ADR_DIR}/\\d{4}-[^/]+\\.md$`).test(p);
const isRuleFile = (p: string) => {
  const m = new RegExp(`^${RULES_DIR}/([^/]+\\.json)$`).exec(p);
  return m !== null && !NOT_RULE_FILES.has(m[1]!);
};

/** Every id and alias in a rules file's text; nothing when it doesn't parse. */
export function idsIn(text: string | undefined): string[] {
  if (text === undefined) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const list: unknown[] = data;
  const out: string[] = [];
  for (const r of list) {
    if (typeof r !== 'object' || r === null) continue;
    const id: unknown = Reflect.get(r, 'id');
    const aliases: unknown = Reflect.get(r, 'aliases');
    if (typeof id === 'string') out.push(id);
    if (Array.isArray(aliases))
      for (const a of aliases as unknown[]) if (typeof a === 'string') out.push(a);
  }
  return out;
}

export function decide(input: {
  labels: string[];
  /** Paths the PR changes (added, modified or deleted). */
  changed: string[];
  /** Rules files on the base and on the PR. */
  baseRuleFiles: string[];
  headRuleFiles: string[];
  read: ReadPair;
}): Decision {
  const { labels, changed, read } = input;
  const errors: string[] = [];

  const adrs = changed.filter(isAdr).filter((p) => {
    const { base, head } = read(p);
    return readRulesLines(base ?? '').length > 0 || readRulesLines(head ?? '').length > 0;
  });
  const touchesRules = changed.some((p) => p.startsWith(`${RULES_DIR}/`));
  if (adrs.length > 0 && !touchesRules && !labels.includes(SKIP_LABEL))
    errors.push(
      `${adrs.join(', ')} changed, but docs/rules/ didn't. Update the rules it adds or changes, or label the PR \`${SKIP_LABEL}\` if the edit changes no fact.`,
    );

  const before = new Set(input.baseRuleFiles.flatMap((p) => idsIn(read(p).base)));
  const after = new Set(input.headRuleFiles.flatMap((p) => idsIn(read(p).head)));
  const gone = [...before].filter((id) => !after.has(id));
  gone.sort();
  if (gone.length > 0)
    errors.push(
      `Rule ids removed: ${gone.join(', ')}. A rule that stops holding changes status, and a renamed one keeps its old id in "aliases".`,
    );

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    message:
      adrs.length === 0
        ? 'No ADR with Rules: lines changed; no rule id removed.'
        : touchesRules
          ? 'The ADR changes come with rules changes; no rule id removed.'
          : `Labelled ${SKIP_LABEL}; no rule id removed.`,
  };
}

const git = (args: string[]): string =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 1 << 28,
  });

const show = (rev: string, path: string): string | undefined => {
  try {
    return execFileSync('git', ['show', `${rev}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
};

const listRuleFiles = (rev: string): string[] => {
  try {
    return git(['ls-tree', '--name-only', `${rev}:${RULES_DIR}`])
      .split('\n')
      .filter(Boolean)
      .map((n) => `${RULES_DIR}/${n}`)
      .filter(isRuleFile);
  } catch {
    return [];
  }
};

const get = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined;

/** The PR's labels from the event payload, or `PR_LABELS` (comma-separated) when run by hand. */
function prLabels(): string[] {
  const fromEnv = process.env['PR_LABELS'];
  if (fromEnv !== undefined)
    return fromEnv
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
  const path = process.env['GITHUB_EVENT_PATH'];
  if (!path) return [];
  const labels = get(get(JSON.parse(readFileSync(path, 'utf8')), 'pull_request'), 'labels');
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((l: unknown) => {
    const name = get(l, 'name');
    return typeof name === 'string' ? [name] : [];
  });
}

function summary(text: string): void {
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (file) appendFileSync(file, `${text}\n`);
}

if (import.meta.main) {
  const since = process.env['BASE_REF'] ?? 'origin/main';
  const base = git(['merge-base', since, 'HEAD']).trim();
  const changed = git(['diff', '--name-only', '--no-renames', base, 'HEAD'])
    .split('\n')
    .filter(Boolean);
  const result = decide({
    labels: prLabels(),
    changed,
    baseRuleFiles: listRuleFiles(base),
    headRuleFiles: listRuleFiles('HEAD'),
    read: (path) => ({ base: show(base, path), head: show('HEAD', path) }),
  });
  if (!result.ok) {
    for (const e of result.errors) {
      console.error(`::error title=Rules::${e}`);
      summary(`**Rules:** ${e}`);
    }
    process.exitCode = 1;
  } else {
    console.log(result.message);
    summary(`**Rules:** ${result.message}`);
  }
}
