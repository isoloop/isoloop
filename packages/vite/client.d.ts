// Types for the modules `@isoloop/vite` provides. Reference it from the app:
// `/// <reference types="@isoloop/vite/client" />`.

/** `KernelConfig.workers`: the bootstrap's URL, and the bus worker's unless `bus: false`. */
declare module 'virtual:isoloop/workers' {
  const workers: { isolateBootstrap: string; bus?: string };
  export default workers;
}
