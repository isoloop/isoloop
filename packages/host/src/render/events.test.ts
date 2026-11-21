import type { EventType, SerializedEvent } from '@isoloop/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { FORWARDED_EVENTS, listenEvents } from './events';

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

const MODS = { alt: false, ctrl: false, meta: false, shift: false };

function setup(wants: (type: EventType) => boolean = () => true) {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const sent: SerializedEvent[] = [];
  const frames: (() => void)[] = [];
  const abort = new AbortController();
  listenEvents(
    shadow,
    {
      toEvent: (_e, type) =>
        wants(type) ? { type, target: '1', currentTargets: ['1'], mods: MODS } : null,
      send: (e) => sent.push(e),
      requestFrame: (fn) => frames.push(fn),
    },
    abort.signal,
  );
  return { shadow, sent, frames, abort };
}

describe('EventBridge', () => {
  it('forwards the fixed set of event types (design §4.6)', () => {
    const { shadow, sent } = setup();
    const button = document.createElement('button');
    shadow.append(button);
    for (const type of FORWARDED_EVENTS) {
      button.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
    }
    expect(sent.map((e) => e.type)).toEqual(FORWARDED_EVENTS);
  });

  it('sends nothing when the isolate has no listener', () => {
    const { shadow, sent } = setup(() => false);
    const button = document.createElement('button');
    shadow.append(button);
    button.click();
    expect(sent).toEqual([]);
  });

  it('always prevents submit, with or without an isolate listener', () => {
    for (const wants of [() => true, () => false]) {
      const { shadow } = setup(wants);
      const form = document.createElement('form');
      shadow.append(form);
      const submit = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(submit);
      expect(submit.defaultPrevented).toBe(true);
    }
  });

  it('leaves other default actions alone', () => {
    const { shadow } = setup();
    const a = document.createElement('a');
    shadow.append(a);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('coalesces pointer moves to one per frame, keeping the latest', () => {
    const { shadow, sent, frames } = setup();
    const div = document.createElement('div');
    shadow.append(div);
    for (let i = 0; i < 5; i++) div.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(sent).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(sent.map((e) => e.type)).toEqual(['pointermove']);
    div.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(frames).toHaveLength(2);
  });

  it('catches scroll, which does not bubble, and sends one per frame per node', () => {
    const { shadow, sent, frames } = setup();
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    outer.append(inner);
    shadow.append(outer);
    for (let i = 0; i < 3; i++) inner.dispatchEvent(new Event('scroll'));
    expect(sent).toEqual([]);
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(sent.map((e) => e.type)).toEqual(['scroll']);
    inner.dispatchEvent(new Event('scroll'));
    expect(frames).toHaveLength(2);
  });

  it('stops listening once aborted', () => {
    const { shadow, sent, abort } = setup();
    const button = document.createElement('button');
    shadow.append(button);
    abort.abort();
    button.click();
    expect(sent).toEqual([]);
  });
});
