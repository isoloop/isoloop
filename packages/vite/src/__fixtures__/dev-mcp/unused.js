// Imported but never called: tree-shaken away, so nothing of it ships.
import { connectDevMCP } from '@isoloop/host/dev-mcp';

if (import.meta.env.DEV)
  connectDevMCP(
    { tools: () => [], request: () => Promise.reject(new Error('no')) },
    { token: 't' },
  );
console.log('app');
