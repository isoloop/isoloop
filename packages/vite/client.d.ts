// Types for the modules `@isoloop/vite` provides. Reference it from the app:
// `/// <reference types="@isoloop/vite/client" />`.

/** `KernelConfig.workers`: the bootstrap's URL, and the bus worker's unless `bus: false`. */
declare module 'virtual:isoloop/workers' {
  const workers: { isolateBootstrap: string; bus?: string };
  export default workers;
}

/** URLs of the isolates listed in `isoloop({ isolates })`, by name. */
declare module 'virtual:isoloop/isolates' {
  const isolates: Record<string, string>;
  export default isolates;
}

/** The URL of an isolate module (or the contracts module), for `spawn({ src })`. */
declare module '*?isolate' {
  const url: string;
  export default url;
}
