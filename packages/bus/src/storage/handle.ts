/** How long to keep trying a file another worker still holds. */
const HELD_MS = 3000;
const RETRY_MS = 25;

/**
 * `createSyncAccessHandle`, retried while the file is still held. Sync
 * access handles are exclusive, and a bus worker that was just terminated
 * (a crash, a restart) lets go of its files a moment after the new one
 * starts, so the new one waits for them rather than fail.
 */
export async function syncHandle(file: FileSystemFileHandle): Promise<FileSystemSyncAccessHandle> {
  const until = Date.now() + HELD_MS;
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retried until the file is free
      return await file.createSyncAccessHandle();
    } catch (e) {
      const held = e instanceof DOMException && e.name === 'NoModificationAllowedError';
      if (!held || Date.now() >= until) throw e;
      // oxlint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}
