import type { MakeOptions, Made, Inner, Base } from './chunk.js';
/**
 * Makes a thing.
 * @experimental The shape may change.
 */
export declare function make(o: MakeOptions): Made;
export declare const LIMIT: number;
/** An error with a code. */
export declare class Oops extends Error {
  code: string;
}
/** Colours. */
export declare enum Colour {
  Red = 0,
}
/** @internal For other packages only. */
export declare function secret(): void;
/** A value and a type with one name. */
export declare const Both: { a: 1 };
export type Both = typeof Both;
/** Not reached by anything. */
export type Lonely = { x: 1 };
export type { MakeOptions, Made, Inner, Base };
