/*
 * Seam members an isolate gets in the shape of the version it was built for,
 * during their minor of deprecation (ADR 0012, *Changing a member by stamp*).
 * The `requires` stamp picks the shape, never the arguments.
 *
 * 0.2: an isolate stamped below 0.2 gets 0.1's `publish(topic, { value, key? })`.
 * Removed in 0.3, when `FLOOR` moves to 0.2 (#467).
 */
import { compareVersions, majorMinor } from '@isoloop/protocol';
import { version } from '../../package.json';
import type { BusClient } from './bus-client';

/** The release that changed `publish`'s shape. */
const NEW_PUBLISH = '0.2';

/**
 * Does an isolate stamped `requires` get 0.1's `publish`? Only when it was
 * built before 0.2 and this runtime is 0.2 or later. An unstamped isolate gets
 * the current shape.
 * @param own This runtime's `major.minor`. Default: from the package version.
 */
export function usesOldPublish(
  requires: string | undefined,
  own: string = majorMinor(version) ?? '0.0',
): boolean {
  if (requires === undefined || majorMinor(requires) === undefined) return false;
  return compareVersions(requires, NEW_PUBLISH) < 0 && compareVersions(own, NEW_PUBLISH) >= 0;
}

/** What the first old-shape call logs, with `KernelConfig.dev` set. */
export const OLD_PUBLISH_WARNING: string =
  'Isoloop: this isolate was built for 0.1 and calls ctx.bus.publish(topic, { value, key }). ' +
  'Since 0.2 it is publish(topic, value, { key }); the old shape stops working in 0.3. ' +
  'Rebuild the isolate on 0.2 after running npx isoloop@latest migrate.';

/**
 * `bus` with 0.1's `publish(topic, { value, key? })`, the rest unchanged. The
 * first `publish` call runs `warn`, when given.
 */
export function withOldPublish(bus: BusClient, warn?: () => void): BusClient {
  let warned = false;
  return {
    ...bus,
    publish(topic, rec) {
      if (!warned) {
        warned = true;
        warn?.();
      }
      // As 0.1 read it: `rec.value`, and `rec.key` when set.
      const r: unknown = rec;
      if (typeof r !== 'object' || r === null)
        return Promise.reject(new TypeError('publish(topic, rec): rec must be { value, key? }'));
      const key: unknown = Reflect.get(r, 'key');
      return bus.publish(topic, Reflect.get(r, 'value'), typeof key === 'string' ? { key } : {});
    },
  };
}

/**
 * Gives `ctx` the shapes its isolate was built for, before `start` runs: today
 * 0.1's `publish` for an isolate stamped below 0.2.
 * @param dev `KernelConfig.dev`: the first old-shape call logs {@link OLD_PUBLISH_WARNING}.
 * @param own This runtime's `major.minor`. Default: from the package version.
 */
export function applyStamp(
  ctx: { readonly bus: BusClient },
  requires: string | undefined,
  dev: boolean,
  own?: string,
): void {
  if (!usesOldPublish(requires, own)) return;
  const warn = dev ? () => console.warn(OLD_PUBLISH_WARNING) : undefined;
  Reflect.set(ctx, 'bus', withOldPublish(ctx.bus, warn));
}
