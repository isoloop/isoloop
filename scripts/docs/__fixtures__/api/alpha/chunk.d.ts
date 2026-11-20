/** A shape a field refers to. */
interface Inner {
  n: number;
}
/** Options for `make`. */
type MakeOptions = {
  /** Nested, so the graph has to follow fields. */
  inner: Inner;
};
/** What `make` returns. */
interface Made extends Base {
  size: number;
}
/** A base the heritage clause names. */
interface Base {
  id: string;
}
export type { Inner, MakeOptions, Made, Base };
