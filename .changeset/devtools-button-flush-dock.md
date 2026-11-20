---
'@isoloop/devtools': minor
---

The devtools button is bigger (70 px) and shows the Isoloop mark, in white on a round dark tile. Hover it and two small chevrons appear to move it one corner across or up and down.

The closed button has a ring of twelve arcs, one stretch of isolates each, coloured by their worst state (green, amber, red, or grey without data), with a wave of brightness running round it. `connectDevtools` has a new `healthStatus` option: `'ring'` (the default), `'radar'` (the logo filled by the ring's colours) or `'off'` (a plain white ring).

The open panel docks flush against the window's edge, so it can be dragged to the very bottom. It resizes from either inner edge or the corner, and its toolbar has a stretch button (full width, the height still adjustable) and a maximize button, both toggling back and kept across reloads. The tab bars and the tables' headers stay in view while the rows scroll, there is a second level of tabs (Pools beside the isolates, and Topics, Subscriptions and Rejected on the Bus view), and the isolates table has an Actions header.

The new Events tab lists the kernel's own history: isolates changing state, crashing or failing, and the bus restarting. It keeps all of this page session's events, not only the feed's last 200, and the last 3 sessions before it in IndexedDB (up to 6,000 events each, about 5 MB), to read back after a reload. Its tab counts the problems you haven't acknowledged, and an Acknowledge button marks them as seen.

The tab that shows the records an app publishes is now called Messages. Its columns have a fixed width, its values are coloured, and a row opens into its value and its record, each with a Copy button.
