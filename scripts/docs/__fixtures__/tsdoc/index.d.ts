/** Options for {@link good}. */
export interface GoodOptions {
  /** How many. Default `1`. */
  count?: number;
  label?: string;
}

/**
 * Does a good thing.
 * @param name - The name.
 * @param opts - The options.
 * @returns The answer.
 * @example
 * ```ts
 * import { good } from 'fixture';
 * good('a');
 * ```
 */
export declare function good(name: string, opts?: GoodOptions): number;

/** Overloaded.
 * @param a - one
 */
export declare function over(a: string): void;
/** Overloaded with two.
 * @param a - one
 * @param b - two
 */
export declare function over(a: string, b: number): void;

/** Destructured. @param props - things */
export declare function destr({ a }: { a: string }): Promise<void>;

/** A class. */
export declare class Thing {
  /** Make one. @param n - size */
  constructor(n: number);
  /** Size, see ADR 0007. */
  size: number;
}

/** A callable const. @param x - the x @returns double */
export declare const twice: (x: number) => number;

export declare const BARE: number;

export interface Kernel {
  /** Ask. @experimental @example
   * ```ts
   * kernel.request('a');
   * ```
   */
  request(topic: string): Promise<unknown>;
}

/** For other packages only. @internal */
export declare function hidden(): void;

/** Extends the options. */
export interface MoreOptions extends GoodOptions {
  /** More. */
  more?: boolean;
}
