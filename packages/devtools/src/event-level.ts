/*
 * What a kernel event means for the ring and the Events tab: how serious it is,
 * what it is about, and one line of what happened.
 */
import type { InspectEvent } from '@isoloop/protocol';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export type EventLevel = 'bad' | 'warn' | 'good' | 'info';

/** How serious an event is, in the ring's terms: failed is red, a crash or a stall amber. */
export function levelOfEvent(e: InspectEvent): EventLevel {
  switch (e.event) {
    case 'isolate:failed':
    case 'bus:failed':
      return 'bad';
    case 'isolate:crash':
    case 'isolate:error':
    case 'bus:crash':
    case 'bus:recovered':
    case 'bus:quota':
    case 'bus:durability-degraded':
    case 'workers:budget':
    case 'agents:unmatched':
      return 'warn';
    case 'isolate:ready':
    case 'bus:ready':
      return 'good';
    case 'isolate:state': {
      const state = str(e.data['state']);
      if (state === 'failed') return 'bad';
      if (state === 'running') return 'good';
      return ['blocked', 'restarting', 'crashed'].includes(state) ? 'warn' : 'info';
    }
    default:
      return 'info';
  }
}

/** How many of the events were problems (for the tab's badge). */
export const problemCount = (events: readonly InspectEvent[]): number =>
  events.filter((e) => {
    const l = levelOfEvent(e);
    return l === 'bad' || l === 'warn';
  }).length;

/** What the event is about: its isolate, or the bus. */
export const subjectOf = (e: InspectEvent): string => {
  const id = str(e.data['id']);
  if (id) return id;
  return e.event.startsWith('bus:') ? 'bus' : '';
};

const show = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    ? String(v)
    : JSON.stringify(v);

/** One line of what happened. */
export function detailOf(e: InspectEvent): string {
  const d = e.data;
  if (e.event === 'isolate:state') return `${str(d['prev'])} → ${str(d['state'])}`;
  if (e.event === 'isolate:crash' || e.event === 'isolate:failed' || e.event === 'bus:crash') {
    return [str(d['reason']), str(d['message'])].filter(Boolean).join(': ');
  }
  if (e.event === 'isolate:error') return str(d['message']);
  return Object.entries(d)
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => `${k}=${show(v)}`)
    .join(' ');
}
