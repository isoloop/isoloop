/*
 * The DOM usage fixture for Preact (M3a task 2): renders into the subset with
 * every member access logged, drives it through host events, and posts the
 * log. It renders `./app`.
 */
import { tracker } from './tracking';
import { container, dom } from './subset';
import { driveUsageFixture, reportUsage } from '@isoloop/dom/testing/worker';
import { render } from 'preact';
import pkg from 'preact/package.json';
import { App } from './app';

const settle = () => new Promise<void>((r) => setTimeout(r, 10));
await reportUsage(tracker, `preact@${pkg.version}`, async () => {
  render(<App />, container);
  await driveUsageFixture(dom, settle);
  render(null, container);
});
