// The example app's alert engine, which the agents guide's fences import as
// `./alerts`. Only its shape matters here.
import type { BusClient } from '@isoloop/runtime';
import type { z } from 'zod';
import type { alertCreated, alertRule } from './schemas';

export type Source = { bus: BusClient };
export declare function busSource(bus: BusClient): Source;
export declare function runAlerts(src: Source): {
  create(requestId: string, rule: z.infer<typeof alertRule>): z.infer<typeof alertCreated>;
};
