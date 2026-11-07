/*
 * The DOM usage fixture for React (M3a task 2): renders into the subset with
 * every member access logged, drives it through host events, and posts the
 * log. It renders `./app`.
 */
import { tracker } from './tracking';
import { container, dom } from './subset';
import { driveUsageFixture, reportUsage } from '@isoloop/dom/testing/worker';
import { version } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

const settle = () => new Promise<void>((r) => setTimeout(r, 10));
await reportUsage(tracker, `react@${version}`, async () => {
  const root = createRoot(container);
  root.render(<App />);
  await driveUsageFixture(dom, settle);
  root.unmount();
});
