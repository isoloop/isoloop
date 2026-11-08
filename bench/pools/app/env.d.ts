/// <reference types="vite/client" />

declare module 'virtual:members' {
  const members: (() => Promise<{
    default: { start(ctx: unknown): unknown };
  }>)[];
  export default members;
}
