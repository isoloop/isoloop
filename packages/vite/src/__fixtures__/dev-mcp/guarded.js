// The documented way: behind import.meta.env.DEV, so a production build drops it.
const kernel = { tools: () => [], request: () => Promise.reject(new Error('no')) };
if (import.meta.env.DEV) {
  const { connectDevMCP } = await import('@isoloop/host/dev-mcp');
  connectDevMCP(kernel, { token: 't' });
}
console.log('app');
