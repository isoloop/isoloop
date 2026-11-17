// CI: the PR description carries exactly one valid "Site impact:" line
// (isoloop/web ADR 0004, decisions 3 and 4). Runs on pull_request events,
// including edits to the description.
import { appendFileSync, readFileSync } from 'node:fs';
import { parseSiteImpact } from './site-impact-parse.ts';

/** The PR description from the event payload, or `PR_BODY` when run by hand. */
export function prBody(): string {
  const fromEnv = process.env['PR_BODY'];
  if (fromEnv !== undefined) return fromEnv;
  const path = process.env['GITHUB_EVENT_PATH'];
  if (!path) return '';
  const event: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const pr: unknown =
    typeof event === 'object' && event !== null ? Reflect.get(event, 'pull_request') : undefined;
  const body: unknown = typeof pr === 'object' && pr !== null ? Reflect.get(pr, 'body') : undefined;
  return typeof body === 'string' ? body : '';
}

function summary(text: string): void {
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (file) appendFileSync(file, `${text}\n`);
}

if (import.meta.main) {
  const result = parseSiteImpact(prBody());
  if (result.ok) {
    console.log(`Site impact: ${result.value}`);
    summary(`**Site impact:** ${result.value}`);
  } else {
    console.error(`::error title=Site impact::${result.error}`);
    summary(`**Site impact:** missing or invalid. ${result.error} See AGENTS.md.`);
    process.exitCode = 1;
  }
}
