/*
 * Starts the usage log. Imported first by the usage fixture, before the
 * subset and the framework, so what the framework checks while it loads is
 * logged too.
 */
import { trackUsage } from '@isoloop/dom/testing/worker';

export const tracker: ReturnType<typeof trackUsage> = trackUsage();
