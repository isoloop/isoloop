# @isoloop/vite

The Vite plugin: `isoloop`, its options, and the manifest a library build writes.

## `@isoloop/vite`

### `devCsp`

The Content-Security-Policy `isoloop()` sends by default: the hosting
guide's policy, plus what Vite's dev server needs (its HMR socket and
injected styles).

```ts nocheck
function devCsp(origins?: readonly string[]): string;
```

| Parameter | Description |
| --- | --- |
| `origins` | Origins that serve isolate modules or the contracts module, added to `script-src` and `connect-src`. Default: none. |

**Returns:** The policy, as one header value.

**Guides:** [Hosting](../guide/hosting.md).

### `headersFor`

The headers `isoloop()` sends on dev and preview responses, for the same
options: the Content-Security-Policy (unless `csp` is `false`), and COOP and
COEP when `crossOriginIsolated` is set. Use it to send the same headers
from another server.

```ts nocheck
function headersFor(o: HeaderOptions): Record<string, string>;
```

| Parameter | Description |
| --- | --- |
| `o` | The header options, as passed to `isoloop()`. |

**Returns:** The headers by name.

**Guides:** [Hosting](../guide/hosting.md).

### `isoloop`

The Vite plugins for an Isoloop app:
- `virtual:isoloop/workers` gives the isolate bootstrap's and the bus
worker's URLs, for `createKernel({ workers })`;
- `import url from './x.ts?isolate'` gives an isolate module's URL, for
`spawn({ src })`, and a build emits each as its own module with its
exports kept;
- dev and preview responses carry the hosting guide's headers;
- a production build that contains the dev MCP fails, unless
`allowDevMcp` is set.

```ts nocheck
function isoloop(o?: IsoloopOptions): Plugin[];
```

| Parameter | Description |
| --- | --- |
| `o` | The options. Default: none of them set. |

**Returns:** The plugins, for `plugins` in the Vite config.

**Throws:**
- {Error} When `library` is set without any `isolates`. A production build fails while its output still uses `connectDevMCP`.

**Example:**

```ts
import { defineConfig } from 'vite';
import { isoloop } from '@isoloop/vite';

export default defineConfig({ plugins: [isoloop()] });
```

**Guides:** [Hosting](../guide/hosting.md).

### `BuildManifest`

What `isoloop-manifest.json` holds: each isolate's file, relative to the output directory.

```ts nocheck
type BuildManifest = {
  isolates: Record<string, string>;
};
```

| Field | Description |
| --- | --- |
| `isolates` | Each isolate's built file by its name in `isolates`, relative to the output directory. |

### `BuildOptions`

The build options of `isoloop()`: which isolates to build as their own modules, and whether the build is only those.

```ts nocheck
type BuildOptions = {
  isolates?: Readonly<Record<string, string>>;
  library?: boolean;
};
```

| Field | Description |
| --- | --- |
| `isolates?` | Isolate entries by name, relative to the Vite root. Each is built as its own ES module, with its exports kept, even if nothing imports it; `virtual:isoloop/isolates` maps the names to their URLs, and the build writes `isoloop-manifest.json`. Default: none. |
| `library?` | Build only the isolates (library mode), not an app, for a repository that ships isolates to someone else's host. Needs `isolates`. Default `false`. |

### `DevMcpGuardOptions`

The production build's check for the dev MCP.

```ts nocheck
type DevMcpGuardOptions = {
  allowDevMcp?: boolean;
};
```

| Field | Description |
| --- | --- |
| `allowDevMcp?` | **Experimental.** Let a production build contain `@isoloop/host/dev-mcp`. Default `false`: a production build whose output still uses `connectDevMCP` fails, since the dev MCP is for development. Import it behind `if (import.meta.env.DEV)` and the build drops it. |

### `HeaderOptions`

The headers `isoloop()` sends on every dev and preview response.

```ts nocheck
type HeaderOptions = {
  csp?: string | false;
  isolateOrigins?: readonly string[];
  crossOriginIsolated?: boolean;
};
```

| Field | Description |
| --- | --- |
| `csp?` | The Content-Security-Policy to send, or `false` for none. Default: the hosting guide's policy, with `isolateOrigins` in `script-src` and `connect-src`, plus what Vite's dev server needs (its HMR socket and injected styles). |
| `isolateOrigins?` | Origins that serve isolate modules or the contracts module, added to the default policy. Default: none. |
| `crossOriginIsolated?` | Sends COOP `same-origin` and COEP `require-corp`, for `SharedArrayBuffer`. Default `false`. |

### `IsoloopOptions`

The options of `isoloop()`: headers, worker URLs, the isolate build and the dev MCP check.

```ts nocheck
type IsoloopOptions = HeaderOptions & WorkersOptions & BuildOptions & DevMcpGuardOptions;
```

**Guides:** [Hosting](../guide/hosting.md).

### `WorkersOptions`

What `virtual:isoloop/workers` holds.

```ts nocheck
type WorkersOptions = {
  bus?: boolean;
};
```

| Field | Description |
| --- | --- |
| `bus?` | Include the bus worker's URL. Default `true`; an app without `contracts` can drop it. |

<!-- Generated by scripts/docs/api.ts from the published types. Do not edit: run `pnpm docs:api`. -->
