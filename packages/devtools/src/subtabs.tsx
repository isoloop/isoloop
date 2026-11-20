/*
 * The second level of navigation: a quieter bar of pills under the main
 * tabs, for the views that have more than one part (Isolates: isolates and
 * pools; Bus: topics, subscriptions and rejected publishes). Same keyboard
 * pattern as the main tabs (WAI-ARIA tabs): arrows move and focus.
 */
import { useIsolate } from '@isoloop/preact';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';

export type SubItem<Id extends string> = { id: Id; label: string; count?: number };

export const subId = (group: string, id: string): string => `dt-sub-${group}-${id}`;
export const subPanelId = (group: string): string => `dt-subpanel-${group}`;

export function SubTabs<Id extends string>(props: {
  group: string;
  label: string;
  items: readonly SubItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}): JSX.Element {
  const ctx = useIsolate();
  const buttons = useRef<Partial<Record<string, unknown>>>({});
  const { items, value } = props;
  const onKey = (e: KeyboardEvent): void => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    const i = items.findIndex((t) => t.id === value);
    const next = items[(i + step + items.length) % items.length];
    if (!next) return;
    props.onChange(next.id);
    const el = buttons.current[next.id];
    if (el !== undefined) ctx.host.focus(el).catch(() => undefined);
  };
  return (
    <div class="dt-subtabs" role="tablist" aria-label={props.label} onKeyDown={onKey}>
      {items.map((t) => (
        <button
          key={t.id}
          ref={(el) => {
            buttons.current[t.id] = el ?? undefined;
          }}
          id={subId(props.group, t.id)}
          type="button"
          role="tab"
          data-subtab={t.id}
          aria-selected={value === t.id ? 'true' : 'false'}
          aria-controls={subPanelId(props.group)}
          tabindex={value === t.id ? 0 : -1}
          class="dt-subtab"
          onClick={() => {
            props.onChange(t.id);
          }}
        >
          {t.label}
          {t.count === undefined ? null : <span class="dt-subcount">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
