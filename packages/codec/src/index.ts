// `@isoloop/codec`: the binary codec for topic records (M2b). The bus writes
// persistent topics with it, and the M5 shared-memory engine will reuse it.
// The byte layout is in format.ts.
export { decode } from './codec/decode';
export { encode } from './codec/encode';
export { CodecError, type CodecErrorCode } from './codec/errors';
