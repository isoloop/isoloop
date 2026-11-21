/** Why the codec refused a value or a byte sequence. */
export type CodecErrorCode =
  /** The value holds something topics can't carry: a function, a symbol, a class instance, a cycle. */
  | 'not_encodable'
  /** The bytes aren't a valid encoding: truncated, an unknown tag, trailing bytes. */
  | 'malformed';

/** Thrown by `encode` and `decode`. */
export class CodecError extends Error {
  readonly code: CodecErrorCode;

  constructor(code: CodecErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'CodecError';
    this.code = code;
  }
}
