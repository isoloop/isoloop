/** Bus values are `unknown`; show strings as they are and anything else as JSON. */
export const text = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));
