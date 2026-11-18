import { describe, expect, it } from 'vitest';
import { INSPECT_MESSAGES, isInspectMessage } from './inspect';

// ADR 0020, decision 7: readers keep what they know and drop the rest.

describe('isInspectMessage', () => {
  it('accepts the feed messages this build knows', () => {
    for (const t of Object.keys(INSPECT_MESSAGES))
      expect(isInspectMessage({ v: 1, t, p: {} })).toBe(true);
  });

  it('drops message types added later, so an older reader ignores them', () => {
    expect(isInspectMessage({ v: 1, t: 'tap-record', p: {} })).toBe(false);
  });

  it('drops envelopes of a protocol version it does not speak', () => {
    expect(isInspectMessage({ v: 2, t: 'event', p: {} })).toBe(false);
    expect(isInspectMessage({ t: 'event', p: {} })).toBe(false);
    expect(isInspectMessage(null)).toBe(false);
  });

  it('keeps a known message with fields it does not know', () => {
    const m = { v: 1, t: 'event', p: { at: 1, event: 'isolate:state', data: {}, later: true } };
    expect(isInspectMessage(m)).toBe(true);
  });
});
