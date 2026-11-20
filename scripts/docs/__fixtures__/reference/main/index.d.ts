/**
 * Starts a widget.
 *
 * It runs until `stop` is called. See {@link Widget} and {@link Options | the options}.
 *
 * @param name - The widget's name.
 * @param o - Its options.
 * @returns The widget, running.
 * @throws `bad_name` when `name` is empty.
 * @example
 * ```ts
 * const w = start('a');
 * ```
 * @see A guide that the map links instead.
 */
export declare function start(name: string, o?: Options): Widget;
/** Stops a widget. @experimental */
export declare function stop(w: Widget): void;
/** The widget limit. */
export declare const MAX: number;
/** A running widget. */
export declare class Widget {
  /** Its name. */
  readonly name: string;
  private secret;
  /** Pauses it. */
  pause(): void;
}
/** How a widget starts. */
export type Options = {
  /**
   * How fast it ticks.
   * @default 60
   */
  rate?: number;
  /** Where it draws. @experimental */
  target?: string;
  /** @internal For the tests. */
  hook?: () => void;
  bare: boolean;
};
