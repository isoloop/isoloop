import type { InspectEvent } from '@isoloop/protocol';
import { describe, expect, it } from 'vitest';
import { detailOf, levelOfEvent, problemCount } from './event-level';

const ev = (event: string, data: Record<string, unknown> = {}): InspectEvent => ({
  at: 1,
  event,
  data,
});

describe('what a kernel event means', () => {
  it('grades events like the ring does: failed is red, a crash or a stall amber', () => {
    expect(levelOfEvent(ev('isolate:failed'))).toBe('bad');
    expect(levelOfEvent(ev('isolate:crash'))).toBe('warn');
    expect(levelOfEvent(ev('isolate:state', { state: 'blocked' }))).toBe('warn');
    expect(levelOfEvent(ev('isolate:state', { state: 'failed' }))).toBe('bad');
    expect(levelOfEvent(ev('isolate:state', { state: 'running' }))).toBe('good');
    expect(levelOfEvent(ev('bus:ready'))).toBe('good');
    expect(levelOfEvent(ev('something:else'))).toBe('info');
  });

  it('counts the problems, the amber and the red ones, and nothing else', () => {
    const events = [
      ev('isolate:ready'),
      ev('isolate:crash'),
      ev('isolate:state', { state: 'running' }),
      ev('isolate:failed'),
      ev('isolate:state', { state: 'restarting' }),
    ];
    expect(problemCount(events)).toBe(3);
    expect(problemCount([])).toBe(0);
  });

  it('says what happened in one line', () => {
    expect(detailOf(ev('isolate:state', { prev: 'crashed', state: 'restarting' }))).toBe(
      'crashed → restarting',
    );
    expect(detailOf(ev('isolate:crash', { reason: 'error', message: 'boom' }))).toBe('error: boom');
    expect(detailOf(ev('workers:budget', { live: 9, budget: 8 }))).toBe('live=9 budget=8');
  });
});
