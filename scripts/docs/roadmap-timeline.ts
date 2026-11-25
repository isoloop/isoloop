// The release timeline in the root README's Roadmap section: two SVGs, light
// and dark, drawn from ENTRIES below. Edit ENTRIES, then run
// `node scripts/docs/roadmap-timeline.ts` to write both files again. The
// plans' Conventions ask a grilling that changes the order to update this
// list too. The README's <img> alt text repeats the entries for readers that
// can't see the image, so update it in the same change.
import { writeFileSync } from 'node:fs';

interface Entry {
  version: string;
  title: string;
  lines: string[];
  done?: boolean;
}

const ENTRIES: Entry[] = [
  {
    version: '0.1',
    title: 'The core (out)',
    lines: ['Kernel, bus and durable log; worker pools;', 'devtools and agent tools.'],
    done: true,
  },
  { version: '0.2', title: 'Watchers', lines: ['Current values beside streams.'] },
  { version: '0.3', title: 'Bus pacing', lines: ['Fewer messages per record; watchers in pools.'] },
  {
    version: '0.4',
    title: 'Shared memory and Tauri',
    lines: ['An opt-in shared-memory engine, and a Tauri', 'package for desktop apps.'],
  },
  {
    version: '0.5',
    title: 'WebMCP to stable',
    lines: ['If WebMCP has shipped by then; otherwise the', 'adapters move up one.'],
  },
  { version: '0.6 to 0.8', title: 'More adapters', lines: ['Vue, Svelte and Solid.'] },
  { version: '1.0', title: 'Stable API', lines: ['Semver majors from here on.'] },
  { version: '2.0', title: 'Beyond the browser', lines: ['Node, Bun and server-side rendering.'] },
];

interface Theme {
  label: string;
  title: string;
  text: string;
  done: string;
  ahead: string;
  dotFill: string;
}

const THEMES: Record<'light' | 'dark', Theme> = {
  light: {
    label: '#6b7280',
    title: '#111827',
    text: '#6b7280',
    done: '#111827',
    ahead: '#d1d5db',
    dotFill: '#ffffff',
  },
  dark: {
    label: '#9ca3af',
    title: '#f3f4f6',
    text: '#9ca3af',
    done: '#f3f4f6',
    ahead: '#4b5563',
    dotFill: '#0d1117',
  },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const WIDTH = 520;
const LABEL_X = 76;
const DOT_X = 96;
const TEXT_X = 120;
const TITLE_GAP = 22;
const LINE_HEIGHT = 20;
const ENTRY_GAP = 26;
const TOP = 20;

function escape(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function draw(theme: Theme): string {
  let y = TOP;
  const placed: (Entry & { top: number })[] = [];
  for (const e of ENTRIES) {
    placed.push(Object.assign({ top: y }, e));
    y += TITLE_GAP + e.lines.length * LINE_HEIGHT + ENTRY_GAP;
  }
  const height = y - ENTRY_GAP + 8;
  const parts: string[] = [];
  // The line between each dot and the next: solid up to the last released
  // version, dashed after it.
  let previous: (typeof placed)[number] | undefined;
  for (const e of placed) {
    if (previous) {
      const done = e.done === true;
      parts.push(
        `<line x1="${DOT_X}" y1="${previous.top + 7}" x2="${DOT_X}" y2="${e.top - 7}" stroke="${done ? theme.done : theme.ahead}" stroke-width="2"${done ? '' : ' stroke-dasharray="3 4"'}/>`,
      );
    }
    previous = e;
  }
  for (const e of placed) {
    const top = e.top;
    const done = e.done === true;
    parts.push(
      `<text x="${LABEL_X}" y="${top + 5}" text-anchor="end" font-size="13" fill="${theme.label}">${escape(e.version)}</text>`,
      `<circle cx="${DOT_X}" cy="${top}" r="6" fill="${done ? theme.done : theme.dotFill}" stroke="${done ? theme.done : theme.ahead}" stroke-width="2"/>`,
      `<text x="${TEXT_X}" y="${top + 5}" font-size="15" font-weight="600" fill="${theme.title}">${escape(e.title)}</text>`,
    );
    e.lines.forEach((line, j) => {
      parts.push(
        `<text x="${TEXT_X}" y="${top + 5 + TITLE_GAP + j * LINE_HEIGHT}" font-size="13.5" fill="${theme.text}">${escape(line)}</text>`,
      );
    });
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="${FONT}">`,
    ...parts.map((p) => `  ${p}`),
    '</svg>',
    '',
  ].join('\n');
}

for (const name of ['light', 'dark'] as const) {
  const file = new URL(`../../docs/assets/roadmap-${name}.svg`, import.meta.url);
  writeFileSync(file, draw(THEMES[name]));
}
