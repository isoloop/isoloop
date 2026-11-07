/// <reference types="vite/client" />
/// <reference types="@isoloop/vite/client" />

/** URL of an isolate module, from the `isoloop:isolate-url` plugin in vite.config.ts. */
declare module '*?isolate' {
  const url: string;
  export default url;
}
