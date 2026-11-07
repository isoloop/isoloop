# Investigation: OPFS sync access handles across browsers

- **Date:** 2026-11-07
- **Question:** Persistent topics need `FileSystemFileHandle.createSyncAccessHandle()` in the bus worker. What should a browser without it get? The 2026-11-06 decision ([M2b plan](../plans/m2b-durable-log.md), task 15): memory topics with `bus:durability-degraded` (`no-sync-access`), with IndexedDB moved to [would-like](../would-like.md). This holds unless a major browser lacks sync access in normal browsing.
- **Answer:** the decision holds. Chrome, Edge, Firefox and Safari have had sync access handles in dedicated workers since 2022 and 2023, so no major browser lacks them in normal browsing. Private browsing is where they're missing: Firefox, and Safari at least when OPFS shipped, refuse `getDirectory()` there. The bus already falls back to memory in that case, reported as `open-failed`.

## Support data

From [MDN browser-compat-data](https://github.com/mdn/browser-compat-data) (`api/FileSystemFileHandle.json` and `api/StorageManager.json`, read 2026-11-07):

| | `StorageManager.getDirectory` | `FileSystemFileHandle.createSyncAccessHandle` |
| --- | --- | --- |
| Chrome / Edge | 86 | 102 |
| Chrome Android | 109 | 109 |
| Firefox | 111 | 111 |
| Safari / Safari iOS | 15.2 | 15.2 |

`createSyncAccessHandle`'s `mode` option (Chrome 121 only, experimental) isn't used: the bus takes the default exclusive handle and coordinates tabs with a Web Lock (M2b task 13). Both APIs belong to the [web-features](https://github.com/web-platform-dx/web-features) feature `origin-private-file-system`, which MDN lists as available across browsers since March 2023. That is Baseline "newly available", so not yet the "widely available" that [ADR 0009](../adr/0009-toolchain.md#rules) rule 7 targets. Without a fallback, this would be a reason to wait. With one, every browser runs the bus, and only durability depends on the API.

## Where it's missing

- **Private browsing:**
  - **Firefox** rejects `navigator.storage.getDirectory()` in a private window with a `SecurityError`, on purpose: Mozilla's test [`dom/tests/mochitest/fs/test_privateWin.html`](https://searchfox.org/firefox-main/source/dom/tests/mochitest/fs/test_privateWin.html) asserts it.
  - **Safari:** WebKit's [OPFS announcement](https://webkit.org/?p=12257) said the API was unavailable in private windows. Current behaviour isn't documented there.
  - MDN's [`getDirectory()` page](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/getDirectory) lists the `SecurityError` "in some browsers … in private browsing mode".
  - Either way the bus's `storage.open()` throws, the bus runs every topic in memory, and the kernel emits `bus:durability-degraded { reason: 'open-failed' }`.
- **Cross-site iframes in Firefox:** `getDirectory()` throws there too ([bug 1870807](https://bugzilla.mozilla.org/show_bug.cgi?id=1870807), open). Same fallback.
- **Playwright's WebKit build** has `createSyncAccessHandle` on the prototype, but `getDirectory()` throws `UnknownError`, even in a persistent context; real Safari works. Our tests treat it as a browser without OPFS (`open-failed`), and the OPFS-only tests skip there.
- **Older browsers** (before the versions above) have no sync access handles at all: `OpfsStorage.available()` is false, and the bus reports `no-sync-access`.

## What the bus does

| Situation | `ready.storage` | `bus:durability-degraded` |
| --- | --- | --- |
| OPFS with sync handles, the lock taken | `opfs` | none |
| Another tab holds the `isoloop-bus` lock (task 13) | `memory` | `another-tab` |
| No `createSyncAccessHandle` | `memory` | `no-sync-access` |
| `getDirectory()` or opening the files throws (private browsing, Playwright's WebKit) | `memory` | `open-failed` |
| No persistent topic in the contracts | `memory` | none |

The bus-worker browser test (`worker.browser.test.ts`) deletes `createSyncAccessHandle` from the prototype in a worker fixture. It then checks that the bus starts in memory, reports `no-sync-access`, and that a persistent topic works as a memory one, in Chromium, Firefox and WebKit.

## IndexedDB

IndexedDB works almost everywhere OPFS doesn't: Firefox has supported it in private windows since version 115. But it would be a second storage engine, with its own segment layout, recovery and tests, kept only for private windows and old browsers. That isn't worth it for 0.1, so it stays in [would-like](../would-like.md).
