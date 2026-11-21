import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, defaultClientConditions } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { isDevMcpModule } from './guard';
import { isoloop, type IsoloopOptions } from '../index';

// M4a task 7 (ADR 0018, decision 8): a production build that still contains
// `@isoloop/host/dev-mcp` fails, unless `allowDevMcp: true`.

const root = fileURLToPath(new URL('../__fixtures__/dev-mcp', import.meta.url));
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function run(entry: string, o: IsoloopOptions = {}, mode = 'production'): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'isoloop-vite-guard-'));
  dirs.push(out);
  // Vitest sets NODE_ENV=test, and Vite takes production (import.meta.env.DEV
  // false) from NODE_ENV; set it as `vite build` would.
  const env = process.env['NODE_ENV'];
  process.env['NODE_ENV'] = mode;
  await build({
    root,
    mode,
    configFile: false,
    logLevel: 'silent',
    plugins: isoloop({ ...o, library: false }),
    resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
    build: {
      outDir: out,
      emptyOutDir: true,
      minify: false,
      target: 'esnext',
      rolldownOptions: { input: join(root, entry) },
    },
  }).finally(() => {
    process.env['NODE_ENV'] = env;
  });
  const files = await readdir(join(out, 'assets'));
  const code = await Promise.all(files.map((f) => readFile(join(out, 'assets', f), 'utf8')));
  return code.join('\n');
}

describe('the dev MCP guard', () => {
  it('fails a production build that contains connectDevMCP', async () => {
    await expect(run('unguarded.js')).rejects.toThrow(/contains the dev MCP.*allowDevMcp: true/s);
  });

  it('passes when the dev MCP is behind import.meta.env.DEV, or imported and unused', async () => {
    expect(await run('guarded.js')).not.toContain('dev MCP connected');
    expect(await run('unused.js')).not.toContain('dev MCP connected');
  });

  it('passes with allowDevMcp: true, and in a development-mode build', async () => {
    expect(await run('unguarded.js', { allowDevMcp: true })).toContain('dev MCP connected');
    expect(await run('unguarded.js', {}, 'development')).toContain('dev MCP connected');
  });

  it('knows the module in the repo and once published', () => {
    expect(isDevMcpModule('/r/packages/host/src/dev-mcp.ts')).toBe(true);
    expect(isDevMcpModule('/r/packages/host/dist/dev-mcp.js')).toBe(true);
    expect(isDevMcpModule('/app/node_modules/@isoloop/host/dist/dev-mcp.js')).toBe(true);
    expect(isDevMcpModule('C:\\app\\node_modules\\@isoloop\\host\\dist\\dev-mcp.js')).toBe(true);
    expect(isDevMcpModule('/app/src/host/src/dev-mcp.ts')).toBe(false);
    expect(isDevMcpModule('/app/node_modules/@isoloop/host/dist/index.js')).toBe(false);
  });
});
