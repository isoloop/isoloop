import { defaultClientConditions, defineConfig } from 'vite';

// A strict style policy, sent as a header on `?csp=strict` (e2e/csp.spec.ts).
const STRICT = "style-src 'self'";

// Workspace packages resolve to their src (ADR 0009, rule 3), as in the demo.
export default defineConfig({
  resolve: { conditions: ['@isoloop/source', ...defaultClientConditions] },
  worker: { format: 'es' },
  base: './',
  plugins: [
    {
      name: 'strict-csp',
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (new URL(req.url ?? '/', 'http://x').searchParams.get('csp') === 'strict') {
            res.setHeader('content-security-policy', STRICT);
          }
          next();
        });
      },
    },
  ],
});
