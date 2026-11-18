import { describe, expect, it } from 'vitest';
import {
  INSPECT_MESSAGES,
  ISOLATE_TO_INSPECT,
  isInspectMessage,
  isInspectToIsolate,
  isIsolateToInspect,
} from './inspect';
import { isHostToIsolate } from './isolate';

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

// ADR 0020, decision 6: the `inspect` port's own messages.
describe('the inspect port', () => {
  it('reads what an isolate asks, and drops the rest', () => {
    for (const t of Object.keys(ISOLATE_TO_INSPECT))
      expect(isIsolateToInspect({ v: 1, t, id: 'i1', p: {} })).toBe(true);
    expect(isIsolateToInspect({ v: 1, t: 'publish', p: {} })).toBe(false);
  });

  it('carries the feed, results and tapped records to the isolate', () => {
    for (const t of [...Object.keys(INSPECT_MESSAGES), 'result', 'record', 'skipped'])
      expect(isInspectToIsolate({ v: 1, t, p: {} })).toBe(true);
    expect(isInspectToIsolate({ v: 1, t: 'deliver', p: {} })).toBe(false);
  });

  it('hands the port over in an `inspect` isolate message', () => {
    expect(isHostToIsolate({ v: 1, t: 'inspect', p: { port: null } })).toBe(true);
  });
});
