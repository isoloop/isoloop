/*
 * The dev MCP guard (ADR 0018, decision 8; M4a decision 11): a production
 * build fails when its output still contains `connectDevMCP` from
 * `@isoloop/host/dev-mcp`, so the dev MCP never ships by accident. Imported
 * behind `if (import.meta.env.DEV)`, it's dropped from the build and the
 * guard passes. `allowDevMcp: true` turns it off.
 */
import type { Plugin } from 'vite';

/** The production build's check for the dev MCP. */
export type DevMcpGuardOptions = {
  /**
   * Let a production build contain `@isoloop/host/dev-mcp`. Default `false`:
   * a production build whose output still uses `connectDevMCP` fails, since
   * the dev MCP is for development. Import it behind
   * `if (import.meta.env.DEV)` and the build drops it.
   * @experimental
   */
  allowDevMcp?: boolean;
};

/**
 * The dev MCP module: `dist/dev-mcp.js` of the published `@isoloop/host`, or
 * in this repo `packages/host/src/dev-mcp.ts` (the source condition) or its
 * `dist/dev-mcp.js`.
 */
const DEV_MCP_MODULE =
  /(?:[\\/]@isoloop[\\/]host[\\/]dist[\\/]dev-mcp\.js|[\\/]packages[\\/]host[\\/](?:src[\\/]dev-mcp\.ts|dist[\\/]dev-mcp\.js))$/;

/** True for a module id that is the dev MCP's page side. */
export const isDevMcpModule = (id: string): boolean => DEV_MCP_MODULE.test(id.split('?')[0] ?? id);

export function devMcpGuard(o: DevMcpGuardOptions): Plugin {
  let check = false;
  return {
    name: 'isoloop:dev-mcp-guard',
    apply: 'build',
    configResolved(c) {
      check = c.isProduction && o.allowDevMcp !== true;
    },
    generateBundle(_opts, bundle) {
      if (!check) return;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, m] of Object.entries(chunk.modules)) {
          // Tree-shaken away (only imported, never used) renders nothing.
          if (m.renderedLength === 0 || !isDevMcpModule(id)) continue;
          this.error(
            `@isoloop/vite: this production build contains the dev MCP (connectDevMCP from ` +
              `@isoloop/host/dev-mcp, in ${chunk.fileName}). Import it behind ` +
              `if (import.meta.env.DEV), or pass isoloop({ allowDevMcp: true }).`,
          );
        }
      }
    },
  };
}
