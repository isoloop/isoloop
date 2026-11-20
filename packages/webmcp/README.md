# @isoloop/webmcp

**Experimental.** Registers the tools an [Isoloop](https://github.com/isoloop/isoloop) app exposes (`agents.expose`) with the browser's [WebMCP](https://webmachinelearning.github.io/webmcp/) API, so an agent built into the browser can call them.

```sh
npm install @isoloop/webmcp@next @isoloop/host@next
```

```ts
import { createKernel } from '@isoloop/host';
import { connectWebMCP } from '@isoloop/webmcp';

const kernel = createKernel({ contracts, workers, agents: { expose: ['markets.quote.v1'] } });
const disconnect = connectWebMCP(kernel);
```

What gets registered, the browsers that have WebMCP, the dev MCP for the others, and how to make a topic a tool are in the [agents guide](https://github.com/isoloop/isoloop/blob/main/docs/guide/agents.md).
