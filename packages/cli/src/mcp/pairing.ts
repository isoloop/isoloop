/*
 * Pairing (ADR 0018, decision 8): any site open in the browser can dial
 * ws://127.0.0.1, so the CLI accepts a page only from an allowed `Origin`
 * and only with its token.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** `--origin`'s default: any port on localhost, over http. */
export const DEFAULT_ORIGIN = 'http://localhost:*';

/** A fresh token for one run: 24 random bytes, base64url. */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** True when `given` is the token, compared in constant time. */
export function tokenMatches(token: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Builds the Origin check from `--origin`: one pattern or several, comma
 * separated. `*` matches any run of characters but `/`, so
 * `http://localhost:*` allows every port and nothing else. A request without
 * an `Origin` header is refused: browsers always send one.
 */
export function originMatcher(patterns: string): (origin: string | undefined) => boolean {
  const res = patterns
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(
      (p) =>
        new RegExp(
          `^${p
            .split('*')
            .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*')}$`,
        ),
    );
  return (origin) => origin !== undefined && res.some((re) => re.test(origin));
}
