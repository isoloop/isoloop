/*
 * `isoloop mcp` (M4a decisions 9–13, ADR 0018 decision 8): the dev MCP
 * server. An agent runs it over stdio (`claude mcp add isoloop -- npx isoloop
 * mcp`); pages in development connect to its WebSocket with `connectDevMCP`
 * from `@isoloop/host/dev-mcp`, and their exposed tools become MCP tools.
 * It runs until stdin ends.
 */
import { DEV_MCP_CLOSE, DEV_MCP_PORT } from '@isoloop/protocol';
import { UsageError } from '../args';
import { EXIT, type Command } from '../command';
import { listenForPages } from '../mcp/pages';
import { DEFAULT_ORIGIN, newToken, originMatcher } from '../mcp/pairing';
import { DevMcpServer } from '../mcp/server';
import { frame, readMessages } from '../mcp/stdio';
import { version } from '../version';

function portOf(value: string | true | undefined): number {
  if (value === undefined) return DEV_MCP_PORT;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < 0 || n > 65_535) {
    throw new UsageError(`--port must be a port number (0 to 65535), not ${String(value)}`);
  }
  return n;
}

const errorCode = (e: unknown): unknown =>
  typeof e === 'object' && e !== null ? Reflect.get(e, 'code') : undefined;

export const mcp: Command = {
  path: ['mcp'],
  summary: 'Run the dev MCP server: the tools of pages in development, for agents',
  usage: '',
  details: [
    'Speaks MCP over stdio. Pages connect to ws://127.0.0.1:<port> with',
    "connectDevMCP(kernel, { url, token }) from '@isoloop/host/dev-mcp'.",
    'The token is printed on stderr, or fixed with ISOLOOP_MCP_TOKEN.',
    '',
    'Claude Code: claude mcp add isoloop -- npx isoloop mcp',
  ].join('\n'),
  flags: {
    port: {
      type: 'string',
      value: 'port',
      description: `The WebSocket's port on 127.0.0.1 (default ${DEV_MCP_PORT}; 0 picks a free one)`,
    },
    origin: {
      type: 'string',
      value: 'patterns',
      description: `Origins pages may connect from, comma separated, * for any run (default ${DEFAULT_ORIGIN})`,
    },
    'allow-write': {
      type: 'boolean',
      description: 'Also offer the tools that change something (readOnly: false)',
    },
    help: { type: 'boolean', short: 'h', description: 'Show this help' },
  },
  async run(args, io) {
    if (args.positionals.length > 0) {
      throw new UsageError(`unexpected argument ${args.positionals[0] ?? ''}`);
    }
    const port = portOf(args.flags['port']);
    const originFlag = args.flags['origin'];
    const origin = originMatcher(typeof originFlag === 'string' ? originFlag : DEFAULT_ORIGIN);
    const allowWrite = args.flags['allow-write'] === true;
    const fixed = io.env['ISOLOOP_MCP_TOKEN'];
    const token = fixed !== undefined && fixed.length > 0 ? fixed : newToken();
    const log = (line: string): void => io.err(`isoloop mcp: ${line}\n`);
    const server = new DevMcpServer({
      version: version(),
      allowWrite,
      send: (m) => io.out(frame(m)),
      log,
    });
    let ws;
    try {
      ws = await listenForPages({ port, token, origin, server, log });
    } catch (e) {
      log(
        errorCode(e) === 'EADDRINUSE'
          ? `port ${port} is taken (another isoloop mcp?); pass --port`
          : `can't listen on 127.0.0.1:${port}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return EXIT.failed;
    }
    const url = `ws://127.0.0.1:${ws.port}`;
    log(`waiting for pages on ${url}${allowWrite ? ' (--allow-write)' : ''}`);
    log(
      fixed !== undefined && fixed.length > 0 ? 'token: from ISOLOOP_MCP_TOKEN' : `token: ${token}`,
    );
    log(`in the page: connectDevMCP(kernel, { url: '${url}', token })`);
    await readMessages(
      io.stdin,
      (m) => server.handle(m),
      () => server.parseError(),
    );
    server.close();
    await ws.close(DEV_MCP_CLOSE.shutdown, 'isoloop mcp stopped');
    return EXIT.ok;
  },
};
