// release.yml's inline steps, as written there, against a fake npm, curl and
// gh: the stage and finish jobs check nothing out, so their logic can't live
// in a script. And the workflow's shape, where the safety is.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRecord } from './finish.ts';
import { tarballName } from './packages.ts';

const workflow = (name: string): string =>
  readFileSync(`.github/workflows/${name}.yml`, 'utf8').replaceAll('\r\n', '\n');
const release = workflow('release');

/** A job's text, by its key. */
function job(name: string): string {
  const lines = release.split('\n');
  const start = lines.indexOf(`  ${name}:`, lines.indexOf('jobs:'));
  const end = lines.findIndex((line, i) => i > start && /^ {2}[a-z][\w-]*:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** A job's text without its comments. */
const code = (name: string): string =>
  job(name)
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

/** The script of a step's `run: |`, by the step's name. */
function script(step: string): string {
  const lines = release.split('\n');
  const named = lines.indexOf(`      - name: ${step}`);
  const start = lines.indexOf('        run: |', named) + 1;
  const end = lines.findIndex(
    (line, i) => i >= start && line !== '' && !line.startsWith(' '.repeat(10)),
  );
  return lines
    .slice(start, end === -1 ? undefined : end)
    .map((line) => line.slice(10))
    .join('\n');
}

describe('release.yml', () => {
  const jobs = ['verify', 'ci', 'build', 'stage', 'finish-check', 'finish'];

  it('starts by hand only, and no tag starts CI or Pages', () => {
    const triggers = release.slice(release.indexOf('\non:'), release.indexOf('\npermissions:'));
    expect(triggers).not.toMatch(/push|tags|schedule|pull_request|workflow_call/);
    expect(triggers).toContain('default: dry-run');
    for (const name of ['ci', 'pages']) expect(workflow(name)).not.toContain('tags:');
  });

  it('gives the OIDC token and the environment to the stage job only', () => {
    expect(jobs.filter((name) => code(name).includes('id-token'))).toEqual(['stage']);
    expect(jobs.filter((name) => code(name).includes('environment: npm'))).toEqual(['stage']);
    expect(code('stage')).toContain("inputs.mode == 'stage' && github.ref == 'refs/heads/main'");
  });

  it('gives write access to the finish job only', () => {
    expect(jobs.filter((name) => code(name).includes('contents: write'))).toEqual(['finish']);
  });

  it('checks out and installs nothing next to a token', () => {
    for (const name of ['stage', 'finish']) {
      expect(code(name)).not.toMatch(/actions\/checkout|pnpm|npm (install|ci)\b|node scripts/);
    }
  });

  it('restores no cache for the build or the stage', () => {
    for (const name of ['build', 'stage']) {
      expect(code(name)).toContain('package-manager-cache: false');
      expect(code(name)).not.toMatch(/actions\/cache|cache: (true|pnpm|npm)/);
    }
  });

  it('never publishes directly, and puts no expression in a script', () => {
    expect(release).not.toMatch(/npm publish/);
    expect(script('Stage the tarballs')).not.toContain('${{');
    expect(script('Tag and Release')).not.toContain('${{');
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sandbox(commands: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'isoloop-release-test-'));
  dirs.push(root);
  mkdirSync(join(root, 'bin'));
  for (const [name, body] of Object.entries(commands)) {
    const file = join(root, 'bin', name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}`);
    chmodSync(file, 0o755);
  }
  writeFileSync(join(root, 'calls'), '');
  writeFileSync(join(root, 'summary'), '');
  return root;
}

interface Ran {
  status: number | null;
  log: string;
  calls: string[];
  summary: string;
}

function bash(root: string, step: string, env: Record<string, string>): Ran {
  writeFileSync(join(root, 'calls'), '');
  writeFileSync(join(root, 'summary'), '');
  const ran = spawnSync('bash', ['-e', '-c', script(step)], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env['PATH']}`,
      FAKE: root,
      RUNNER_TEMP: root,
      GITHUB_STEP_SUMMARY: join(root, 'summary'),
      ...env,
    },
  });
  return {
    status: ran.status,
    log: `${ran.stdout}${ran.stderr}`,
    calls: readFileSync(join(root, 'calls'), 'utf8').split('\n').filter(Boolean),
    summary: readFileSync(join(root, 'summary'), 'utf8'),
  };
}

// The steps run on ubuntu-latest: GNU tar and coreutils, jq.
const linux = describe.runIf(process.platform === 'linux');

linux('the stage step', { timeout: 30_000 }, () => {
  const VERSION = '0.1.0-next.12';
  const NAMES = ['@isoloop/protocol', '@isoloop/host', 'isoloop'];

  const FAKE_NPM = `echo "npm $*" >> "$FAKE/calls"
case "$3" in *"\${FAIL_ON:-no-package}"*)
  echo "npm error code E409: this version is already staged" >&2
  exit 1;;
esac
echo "+ package (staged with id id-$(wc -l < "$FAKE/calls" | tr -d ' '))"
`;
  const FAKE_CURL = `if [ -f "$FAKE/packument" ]; then cat "$FAKE/packument"
else echo '{"dist-tags":{"latest":"0.0.0","next":"0.1.0-next.11"},"versions":{"0.1.0-next.11":{}}}'
fi
`;

  interface Stage {
    root: string;
    sums: string;
    env: Record<string, string>;
  }

  /** The tarballs a build hands over; `manifest` changes what's in host's. */
  function built(manifest: Record<string, unknown> = {}): Stage {
    const root = sandbox({ npm: FAKE_NPM, curl: FAKE_CURL });
    mkdirSync(join(root, 'tarballs'));
    const sums: string[] = [];
    const packages: string[] = [];
    for (const [i, name] of NAMES.entries()) {
      const from = join(root, `source-${i}`);
      mkdirSync(join(from, 'package'), { recursive: true });
      const extra = name === '@isoloop/host' ? manifest : {};
      writeFileSync(
        join(from, 'package', 'package.json'),
        JSON.stringify(Object.assign({ name, version: VERSION }, extra)),
      );
      const file = tarballName(name, VERSION);
      const tarball = join(root, 'tarballs', file);
      execFileSync('tar', ['-czf', tarball, '-C', from, 'package/package.json']);
      const bytes = readFileSync(tarball);
      const sha = (algorithm: string): string => createHash(algorithm).update(bytes).digest('hex');
      sums.push(`${file} ${sha('sha1')} ${sha('sha512')}`);
      packages.push(`${i + 1} ${name} ${file} 0.1.0-next.11`);
    }
    const env = {
      VERSION,
      TAG: 'next',
      SUMS: sums.join('\n'),
      PACKAGES: packages.join('\n'),
      GITHUB_RUN_ID: '4500',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_SHA: 'a'.repeat(40),
    };
    return { root, sums: env.SUMS, env };
  }

  const stage = ({ root, env }: Stage, more: Record<string, string> = {}): Ran =>
    bash(root, 'Stage the tarballs', { ...env, ...more });

  it('stages every tarball, in order, and writes the checklist and the record', () => {
    const given = built();
    const ran = stage(given);
    expect(ran.status, ran.log).toBe(0);
    expect(ran.calls).toHaveLength(3);
    for (const [i, name] of NAMES.entries()) {
      expect(ran.calls[i]).toContain(tarballName(name, VERSION));
      expect(ran.calls[i]).toMatch(/^npm stage publish /);
      expect(ran.calls[i]).toContain('--tag next --access public --ignore-scripts --provenance');
    }
    expect(ran.summary).toContain(`Approve ${VERSION}: all 3 staged`);
    expect(ran.summary).toContain('| id-2 |');
    expect(ran.summary).not.toContain('approve nothing');

    const record = parseRecord(readFileSync(join(given.root, 'staged', 'staged.json'), 'utf8'));
    expect(record).toMatchObject({ run: '4500', commit: 'a'.repeat(40), version: VERSION });
    expect(record.packages.map((p) => `${p.file} ${p.sha1} ${p.sha512}`).join('\n')).toBe(
      given.sums,
    );
  });

  it('a partial stage stops at the error, says approve nothing, and leaves no record', () => {
    const given = built();
    const ran = stage(given, { FAIL_ON: 'isoloop-host' });
    expect(ran.status).not.toBe(0);
    expect(ran.calls).toHaveLength(2);
    expect(ran.log).toContain('already staged');
    expect(ran.summary).toContain('| `@isoloop/protocol@0.1.0-next.12` | id-1 |');
    expect(ran.summary).toContain('approve nothing');
    expect(ran.summary).not.toContain('all 3 staged');
    expect(existsSync(join(given.root, 'staged', 'staged.json'))).toBe(false);
  });

  it('a re-run after the rejects stages the same tarballs', () => {
    const given = built();
    stage(given, { FAIL_ON: 'isoloop-host' });
    const ran = stage(given, { GITHUB_RUN_ATTEMPT: '2' });
    expect(ran.status, ran.log).toBe(0);
    expect(ran.calls).toHaveLength(3);
    expect(ran.summary).toContain('(attempt 2)');
  });

  it('a re-run without the rejects fails on "already staged"', () => {
    const ran = stage(built(), { FAIL_ON: 'isoloop-protocol' });
    expect(ran.status).not.toBe(0);
    expect(ran.calls).toHaveLength(1);
  });

  it('stages nothing when one shasum is wrong', () => {
    const given = built();
    const sums = given.sums.replace(/ [0-9a-f]{40} (?=[0-9a-f]+$)/, ` ${'0'.repeat(40)} `);
    const ran = stage(given, { SUMS: sums });
    expect(ran.status).not.toBe(0);
    expect(ran.log).toContain("doesn't match the build's shasums");
    expect(ran.calls).toEqual([]);
  });

  it('stages nothing when the artifact has another file', () => {
    const given = built();
    writeFileSync(join(given.root, 'tarballs', '.npmrc'), 'registry=https://example.invalid/');
    const ran = stage(given);
    expect(ran.log).toContain('exactly 3 files');
    expect(ran.calls).toEqual([]);
  });

  it.each([
    ['another name', { name: '@isoloop/other' }],
    ['another version', { version: '9.9.9' }],
    ['a publishConfig', { publishConfig: { registry: 'https://example.invalid/' } }],
  ])('stages nothing when a tarball has %s', (_, manifest) => {
    const ran = stage(built(manifest));
    expect(ran.status).not.toBe(0);
    expect(ran.log).toContain("isn't a plain @isoloop/host");
    expect(ran.calls).toEqual([]);
  });

  it('stages nothing when the version is on npm already', () => {
    const given = built();
    writeFileSync(
      join(given.root, 'packument'),
      `{"dist-tags":{"next":"0.1.0-next.11"},"versions":{"${VERSION}":{}}}`,
    );
    const ran = stage(given);
    expect(ran.log).toContain('already on npm');
    expect(ran.calls).toEqual([]);
  });

  it('stages nothing when the dist-tag moved since the check', () => {
    const given = built();
    writeFileSync(
      join(given.root, 'packument'),
      '{"dist-tags":{"next":"0.1.0-next.13"},"versions":{}}',
    );
    const ran = stage(given);
    expect(ran.log).toContain('moved since');
    expect(ran.calls).toEqual([]);
  });
});

linux('the finish step', { timeout: 30_000 }, () => {
  const COMMIT = 'a'.repeat(40);
  const FAKE_GH = `echo "gh $*" >> "$FAKE/calls"
case "$*" in
  *matching-refs*) cat "$FAKE/refs";;
  *"-X POST"*/git/tags*) echo '{"sha":"tag-object"}';;
  *"-X POST"*/git/refs*) echo '{}';;
  *git/tags/*) cat "$FAKE/tag";;
  *"/releases?"*) cat "$FAKE/releases";;
  "release create"*) ;;
  *) exit 9;;
esac
`;

  function finish(world: { stable: boolean; taggedAt?: string; released?: boolean }): Ran {
    const root = sandbox({ gh: FAKE_GH });
    const refs = world.taggedAt
      ? [{ ref: 'refs/tags/v0.1.0', object: { type: 'tag', sha: 'tag-object' } }]
      : [];
    writeFileSync(join(root, 'refs'), JSON.stringify(refs));
    writeFileSync(join(root, 'tag'), JSON.stringify({ object: { sha: world.taggedAt ?? '' } }));
    writeFileSync(join(root, 'releases'), world.released ? '[{"tag_name":"v0.1.0"}]' : '[]');
    return bash(root, 'Tag and Release', {
      GH_REPO: 'isoloop/isoloop',
      COMMIT,
      TAG: 'v0.1.0',
      STABLE: String(world.stable),
      NOTES: 'The notes, with `code` and $HOME.',
    });
  }

  it('tags the staged commit and makes the Release', () => {
    const ran = finish({ stable: true });
    expect(ran.status, ran.log).toBe(0);
    expect(ran.calls.find((call) => call.includes('/git/tags'))).toContain(`object=${COMMIT}`);
    expect(ran.calls.find((call) => call.includes('/git/refs -f'))).toContain('sha=tag-object');
    expect(ran.calls.at(-1)).toMatch(/^gh release create v0\.1\.0 --verify-tag/);
  });

  it('makes no Release for a preview', () => {
    const ran = finish({ stable: false });
    expect(ran.status, ran.log).toBe(0);
    expect(ran.calls.join('\n')).not.toMatch(/release/);
  });

  it('changes nothing when both are there', () => {
    const ran = finish({ stable: true, taggedAt: COMMIT, released: true });
    expect(ran.status, ran.log).toBe(0);
    expect(ran.calls.join('\n')).not.toMatch(/-X POST|release create/);
  });

  it('finishes a run that tagged and then failed', () => {
    const ran = finish({ stable: true, taggedAt: COMMIT });
    expect(ran.status, ran.log).toBe(0);
    expect(ran.calls.join('\n')).not.toContain('-X POST');
    expect(ran.calls.at(-1)).toMatch(/^gh release create/);
  });

  it('refuses a tag on another commit', () => {
    const ran = finish({ stable: true, taggedAt: 'b'.repeat(40) });
    expect(ran.status).not.toBe(0);
    expect(ran.calls.join('\n')).not.toMatch(/-X POST|release create/);
  });
});
