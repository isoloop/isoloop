// A GitHub Release's body, from the packages' CHANGELOG.md sections for one
// version (ADR 0019, decision 6). The packages share a version, and a
// changeset that names several of them is in each one's changelog, so each
// entry is listed once with the packages it belongs to.

const BUMPS = ['Major', 'Minor', 'Patch'] as const;
type Bump = (typeof BUMPS)[number];

/** GitHub refuses a release body over 125,000 characters. */
export const MAX_BODY = 125_000;

export interface Changelog {
  name: string;
  dir: string;
  text: string;
}

export interface Entry {
  bump: Bump;
  text: string;
}

/** The lines under `## <version>`, or `undefined` when there's no such section. */
export function section(changelog: string, version: string): string[] | undefined {
  const lines = changelog.split(/\r?\n/);
  const start = lines.indexOf(`## ${version}`);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

/** A section's changesets. Lines that only bump an internal dependency are left out. */
export function entries(lines: string[]): Entry[] {
  const found: { bump: Bump; lines: string[] }[] = [];
  let bump: Bump | undefined;
  let open: { bump: Bump; lines: string[] } | undefined;
  for (const line of lines) {
    const heading = BUMPS.find((b) => line === `### ${b} Changes`);
    if (heading) {
      bump = heading;
      open = undefined;
    } else if (bump && line.startsWith('- ')) {
      open = { bump, lines: [line.slice(2)] };
      found.push(open);
    } else {
      open?.lines.push(line.replace(/^ {2}/, ''));
    }
  }
  return found.flatMap((entry) => {
    const [head = ''] = entry.lines;
    if (/^Updated dependencies( \[[0-9a-f]+\])?$/.test(head)) return [];
    if (/^(@isoloop\/[\w-]+|isoloop)@\d+\.\d+\.\d+\S*$/.test(head)) return [];
    const text = entry.lines.join('\n').trim();
    return [{ bump: entry.bump, text: text.replace(/^[0-9a-f]{7,40}: /, '') }];
  });
}

/** GitHub notifies whoever an `@name` names, so one outside code becomes code. */
export const quoteMentions = (text: string): string =>
  text
    .split(/(```[\s\S]*?```|`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(/(?<![\w/`])@[a-z0-9][\w/-]*/gi, (m) => `\`${m}\``),
    )
    .join('');

/** Throws when no package's changelog has a section for `version`. */
export function releaseNotes(version: string, changelogs: Changelog[], repo: string): string {
  if (changelogs.every((log) => section(log.text, version) === undefined)) {
    throw new Error(`no CHANGELOG.md has a "## ${version}" section`);
  }
  const merged = new Map<string, { bump: Bump; names: string[] }>();
  for (const log of changelogs) {
    const name = log.name.replace(/^@isoloop\//, '');
    for (const { bump, text } of entries(section(log.text, version) ?? [])) {
      const seen = merged.get(text);
      if (!seen) {
        merged.set(text, { bump, names: [name] });
        continue;
      }
      if (!seen.names.includes(name)) seen.names.push(name);
      // One changeset can bump its packages differently: it's listed under the highest.
      if (BUMPS.indexOf(bump) < BUMPS.indexOf(seen.bump)) seen.bump = bump;
    }
  }

  const groups = BUMPS.flatMap((bump) => {
    const items = [...merged]
      .filter(([, entry]) => entry.bump === bump)
      .map(([text, { names }]) => {
        const [first = '', ...rest] = quoteMentions(text).split('\n');
        const more = rest.map((line) => (line ? `\n  ${line}` : '\n')).join('');
        return `- **${names.join(', ')}:** ${first}${more}`;
      });
    return items.length === 0 ? [] : [`## ${bump} changes\n\n${items.join('\n')}`];
  });

  const intro = `Every \`@isoloop/*\` package and the \`isoloop\` CLI is at \`${version}\`.`;
  const links = changelogs.map(
    (log) => `[\`${log.name}\`](${repo}/blob/v${version}/${log.dir}/CHANGELOG.md)`,
  );
  const tail = `## Changelogs\n\n${links.join(' · ')}\n`;
  const changes = groups.length === 0 ? ['No changes besides the version.'] : groups;
  const body = [intro, ...changes, tail].join('\n\n');
  if (body.length <= MAX_BODY) return body;
  return [intro, 'The changes are too long to list here; see the changelogs.', tail].join('\n\n');
}
