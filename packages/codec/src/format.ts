// The byte layout of `isoloop-codec@1`. Every value starts with one tag byte;
// small values fit in the tag itself. Multi-byte numbers are little-endian,
// lengths and counts are unsigned LEB128 varints, always minimal, so a value
// has exactly one encoding (the fixed-layout tests rely on it).
//
//   0x00–0x7f  integer 0..127
//   0x80–0x9f  string, 0..31 UTF-8 bytes follow
//   0xa0–0xaf  array, 0..15 items follow
//   0xb0–0xbf  object, 0..15 key/value pairs follow (keys are strings)
//   0xc0       undefined          0xc1  null
//   0xc2       false              0xc3  true
//   0xc4       integer ≥ 0, varint
//   0xc5       integer < 0, varint of (-v - 1)
//   0xc6       float64
//   0xc7       string, varint byte length, UTF-8
//   0xc8       array, varint count
//   0xc9       object, varint count
//   0xca–0xdf  reserved for the other structured-clone types (codec task 4)
//   0xe0–0xff  integer -32..-1

export const FIXSTR = 0x80;
export const FIXARRAY = 0xa0;
export const FIXOBJECT = 0xb0;
export const UNDEFINED = 0xc0;
export const NULL = 0xc1;
export const FALSE = 0xc2;
export const TRUE = 0xc3;
export const UINT = 0xc4;
export const NINT = 0xc5;
export const FLOAT64 = 0xc6;
export const STR = 0xc7;
export const ARRAY = 0xc8;
export const OBJECT = 0xc9;
export const NEG_FIXINT = 0xe0;

export const FIXSTR_MAX = 31;
export const FIXARRAY_MAX = 15;
export const FIXOBJECT_MAX = 15;

/** Nesting deeper than this is rejected; it is also how a cycle is caught. */
export const MAX_DEPTH = 512;
