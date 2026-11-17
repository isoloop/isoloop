// Claude Code PreToolUse hook (.claude/settings.json): before an agent runs
// `gh pr create`, check what CI will check, so the agent fixes it now
// (isoloop/web ADR 0004, decision 4):
// - the description ends with a valid "Site impact:" line;
// - a change under packages/ or apps/ comes with a changeset, unless the
//   title, description or labels say it's internal-only (`no-changeset`).
// Exit 2 blocks the call and shows stderr to the agent; exit 0 lets it run.
// Anything this script can't work out lets the call run: CI still checks.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseSiteImpact } from '../ci/site-impact-parse.ts';

type HookInput = {
  tool_name: string | undefined;
  tool_input: { command: string } | undefined;
  cwd: string | undefined;
};

/** Splits shell words, honouring single and double quotes and backslashes. */
export function words(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end;
      has = true;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1] ?? '')) i++;
        cur += s[i];
        i++;
      }
      has = true;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** The first heredoc's text after `from`: `<<'EOF'`, `<<EOF`, `<<"EOF"` or `<<-EOF`. */
function heredoc(cmd: string, from: number): string | undefined {
  const m = /<<-?\s*(['"]?)([A-Za-z_][\w]*)\1[^\n]*\n/.exec(cmd.slice(from));
  if (!m) return undefined;
  const start = from + m.index + m[0].length;
  const end = new RegExp(`^\\s*${m[2]}\\s*$`, 'm').exec(cmd.slice(start));
  return cmd.slice(start, end ? start + end.index : cmd.length);
}

/** The `gh pr create` part of the command, and the directory it runs in. */
export function prCreate(command: string, cwd: string): { cmd: string; dir: string } | undefined {
  const at = /\bgh\s+pr\s+create\b/.exec(command);
  if (!at) return undefined;
  let dir = cwd;
  for (const m of command
    .slice(0, at.index)
    .matchAll(/(?:^|&&|;|\|\|)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const target = (m[1] ?? '').replace(/^["']|["']$/g, '');
    dir = isAbsolute(target) ? target : join(dir, target);
  }
  return { cmd: command.slice(at.index), dir };
}

/** The PR description the command passes, or undefined when it can't be read (e.g. `--fill`). */
export function body(cmd: string, dir: string): string | undefined {
  const flag = /(?:^|\s)(--body-file|-F|--body|-b)(?:=|\s+)/.exec(cmd);
  if (!flag) return undefined;
  const rest = cmd.slice(flag.index + flag[0].length);
  const isFile = flag[1] === '--body-file' || flag[1] === '-F';
  if (isFile) {
    const target = words(rest)[0];
    if (target === undefined) return undefined;
    if (target === '-') return heredoc(cmd, flag.index);
    try {
      return readFileSync(isAbsolute(target) ? target : join(dir, target), 'utf8');
    } catch {
      return undefined;
    }
  }
  // --body "$(cat <<'EOF' … EOF)" is how agents usually pass a long description.
  if (/^["']?\$\(\s*cat\s*<</.test(rest)) return heredoc(cmd, flag.index);
  return words(rest)[0];
}

function title(cmd: string): string {
  const m = /(?:^|\s)(?:--title|-t)(?:=|\s+)/.exec(cmd);
  return m ? (words(cmd.slice(m.index + m[0].length))[0] ?? '') : '';
}

function git(dir: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** A problem with the changeset, or undefined when there's none (or it can't be told). */
export function changesetProblem(dir: string, text: string): string | undefined {
  const root = git(dir, ['rev-parse', '--show-toplevel']);
  if (!root || !existsSync(join(root, '.changeset'))) return undefined;
  const base = git(root, ['merge-base', 'origin/main', 'HEAD']);
  if (!base) return undefined;
  const changed = (git(root, ['diff', '--name-only', base, 'HEAD']) ?? '')
    .split('\n')
    .filter(Boolean);
  const touchesCode = changed.some((f) => /^(packages|apps)\//.test(f));
  const hasChangeset = changed.some((f) => /^\.changeset\/(?!README)[^/]+\.md$/i.test(f));
  if (!touchesCode || hasChangeset) return undefined;
  if (/\bno-changeset\b|\binternal[- ]only\b/i.test(text)) return undefined;
  return 'This branch changes packages/ or apps/ but adds no changeset. Run `pnpm changeset` and commit it, or, for an internal-only change, add the `no-changeset` label (`--label no-changeset`).';
}

const field = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null ? Reflect.get(o, k) : undefined;

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The fields of Claude Code's hook input this gate reads. */
function hookInput(raw: unknown): HookInput {
  const command = text(field(field(raw, 'tool_input'), 'command'));
  return {
    tool_name: text(field(raw, 'tool_name')),
    tool_input: command === undefined ? undefined : { command },
    cwd: text(field(raw, 'cwd')),
  };
}

function main(): void {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const input = hookInput(raw);
  if (input.tool_name !== 'Bash') return;
  const found = prCreate(input.tool_input?.command ?? '', input.cwd ?? process.cwd());
  if (!found) return;
  const problems: string[] = [];
  const description = body(found.cmd, found.dir);
  if (description === undefined) {
    problems.push(
      'Pass the description with --body, --body-file or -F (with a heredoc or a file), so its "Site impact:" line can be read. `--fill` and an empty body skip it.',
    );
  } else {
    const impact = parseSiteImpact(description);
    if (!impact.ok) problems.push(impact.error);
  }
  const changeset = changesetProblem(
    found.dir,
    `${title(found.cmd)}\n${description ?? ''}\n${found.cmd}`,
  );
  if (changeset) problems.push(changeset);
  if (problems.length > 0) {
    process.stderr.write(
      `PR gate (AGENTS.md, definition of done) blocked \`gh pr create\`:\n${problems.map((p) => `- ${p}`).join('\n')}\n`,
    );
    process.exitCode = 2;
  }
}

if (import.meta.main) main();
