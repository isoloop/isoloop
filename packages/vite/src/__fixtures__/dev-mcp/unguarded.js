/* oxlint-disable no-restricted-imports -- app code, as the guard sees it */
// An app that connects the dev MCP unconditionally: a production build must fail.
import { connectDevMCP } from '@isoloop/host/dev-mcp';

const kernel = { tools: () => [], request: () => Promise.reject(new Error('no')) };
connectDevMCP(kernel, { token: 't' });
