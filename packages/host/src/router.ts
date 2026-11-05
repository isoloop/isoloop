/*
 * Routing (ADR 0002). The host owns the URL; the kernel only reports it on
 * `isoloop.route.v1` and asks the host's `onNavigate` before changing it.
 *
 * - One resolver for `navigate` and links: `/x` → `basePath + x`, anything
 *   else against the document URL; cross-origin is refused.
 * - `sync()` publishes the location when `href` or `state` changed.
 * - With `routing: false` there is no router at all: the kernel answers
 *   `navigate` with `routing_disabled` and leaves links alone.
 */
import { routeTopic, type CallResult, type ErrorCode, type RouteValue } from '@isoloop/protocol';

export type NavigateRequest = {
  /** Absolute, same-origin. */
  href: string;
  replace: boolean;
  state?: unknown;
  /** The isolate that asked, or whose link was clicked. */
  from: string;
};

export type OnNavigate = (req: NavigateRequest) => boolean | Promise<boolean>;

export type RouterOptions = {
  /** Normalised to start and end with `/`. Default `/`. */
  basePath?: string;
  /** Default: `history.pushState` / `replaceState` with `state`. */
  onNavigate?: OnNavigate;
  /** Publishes a route record; resolves once the bus appended it. */
  publish(value: RouteValue): Promise<CallResult>;
  /** True while no bus can take a publish (restarting or down). */
  busDown(): boolean;
  /** `route:state_dropped`. */
  stateDropped(bytes: number): void;
  /** `route:navigate_error`. */
  navigateError(e: { from: string; href: string; error: string }): void;
  /** Dev builds: warn once when the URL is outside `basePath` while isolates are subscribed. */
  dev?: { subscribed(): boolean };
};

export type NavigateResult =
  | { ok: true; value: boolean }
  | { ok: false; code: ErrorCode; message: string };

export interface Router {
  readonly basePath: string;
  /** The absolute URL for an isolate href, or `null` when it is cross-origin. */
  resolve(href: string): URL | null;
  /** What a link's `href` renders as: same-origin hrefs become their resolved absolute URL. */
  rewrite(href: string): string;
  /** Reads `location` and `history.state`; publishes if they changed. Resolves once published. */
  sync(force?: boolean): Promise<void>;
  /** `navigate` from an isolate or a link click; the grant is checked by the caller. */
  navigate(
    href: string,
    o: { replace?: boolean; state?: unknown; from: string },
  ): Promise<NavigateResult>;
  /** Plain primary-button clicks on same-origin links (design §4.6). */
  linkClick(a: HTMLAnchorElement, e: MouseEvent, from: string): void;
  destroy(): void;
}

/** `/app` → `/app/`, `app/` → `/app/`, `` → `/`. */
export function normaliseBase(base: string): string {
  let b = base.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

/** `pathname` relative to `base`, starting with `/`, or `null` outside it. */
export function pathWithin(pathname: string, base: string): string | null {
  if (pathname.startsWith(base)) return `/${pathname.slice(base.length)}`;
  if (`${pathname}/` === base) return '/';
  return null;
}

/** Same as `JSON.stringify`, but `undefined` for values it can't encode (cycles, bigints). */
function fingerprint(v: unknown): string | undefined {
  try {
    return JSON.stringify(v) ?? 'undefined';
  } catch {
    return undefined;
  }
}

/** A rough size, as the bus would count it, for `route:state_dropped`. */
function roughBytes(v: unknown): number {
  const f = fingerprint(v);
  return f === undefined ? -1 : f.length * 2;
}

const defaultNavigate: OnNavigate = ({ href, replace, state }) => {
  if (replace) history.replaceState(state ?? null, '', href);
  else history.pushState(state ?? null, '', href);
  return true;
};

export function createRouter(o: RouterOptions): Router {
  const basePath = normaliseBase(o.basePath ?? '/');
  const onNavigate = o.onNavigate ?? defaultNavigate;
  let last: { href: string; state: string | undefined; raw: unknown } | undefined;
  let warnedBase = false;

  const resolve = (href: string): URL | null => {
    const doc = new URL(document.URL);
    const url =
      href.startsWith('/') && !href.startsWith('//')
        ? new URL(basePath + href.slice(1), doc)
        : new URL(href, doc);
    return url.origin === doc.origin ? url : null;
  };

  const current = (): RouteValue => {
    const { href, pathname, search, hash } = location;
    const state: unknown = history.state;
    return { href, pathname, path: pathWithin(pathname, basePath), search, hash, state };
  };

  const sync = async (force = false): Promise<void> => {
    const value = current();
    const state = fingerprint(value.state);
    const same =
      last !== undefined &&
      last.href === value.href &&
      (state === undefined ? last.raw === value.state : last.state === state);
    if (same && !force) return;
    last = { href: value.href, state, raw: value.state };
    if (value.path === null && o.dev && !warnedBase && o.dev.subscribed()) {
      warnedBase = true;
      console.warn(
        `[isoloop] ${value.pathname} is outside basePath ${basePath}: does KernelConfig.basePath match your router's basename? (ADR 0002)`,
      );
    }
    let r = await o.publish(value);
    if (!r.ok && r.error.code === 'too_large') {
      o.stateDropped(roughBytes(value.state));
      r = await o.publish({ ...value, state: null });
    }
    if (!r.ok && r.error.code !== 'bus_unavailable')
      console.error(`[isoloop] could not publish ${routeTopic.name}: ${r.error.message}`);
  };

  /** Runs `onNavigate`, then syncs; resolves after the route record is in the log, if one was published. */
  const run = async (req: NavigateRequest): Promise<NavigateResult> => {
    let accepted: boolean;
    try {
      accepted = await onNavigate(req);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      o.navigateError({ from: req.from, href: req.href, error });
      return { ok: false, code: 'navigate_failed', message: `onNavigate threw: ${error}` };
    }
    if (!accepted) return { ok: true, value: false };
    // With the bus down, the route arrives with the republish after the restart.
    const synced = sync();
    if (!o.busDown()) await synced;
    return { ok: true, value: true };
  };

  const onPop = (): void => {
    void sync();
  };
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);

  return {
    basePath,
    resolve,

    rewrite(href) {
      let url: URL | null;
      try {
        url = resolve(href);
      } catch {
        return href;
      }
      return url ? url.href : href;
    },

    sync,

    async navigate(href, opts) {
      let url: URL | null;
      try {
        url = resolve(href);
      } catch {
        return {
          ok: false,
          code: 'invalid',
          message: `navigate: ${JSON.stringify(href)} is not a URL`,
        };
      }
      if (!url)
        return {
          ok: false,
          code: 'cross_origin',
          message: `navigate: ${href} is on another origin`,
        };
      const req: NavigateRequest = {
        href: url.href,
        replace: opts.replace ?? false,
        from: opts.from,
      };
      if (opts.state !== undefined) req.state = opts.state;
      return run(req);
    },

    linkClick(a, e, from) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const target = a.getAttribute('target');
      if ((target !== null && target !== '' && target !== '_self') || a.hasAttribute('download'))
        return;
      const raw = a.getAttribute('href');
      if (raw === null) return;
      let url: URL;
      try {
        url = new URL(a.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      e.preventDefault();
      void run({ href: url.href, replace: false, from });
    },

    destroy() {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    },
  };
}
