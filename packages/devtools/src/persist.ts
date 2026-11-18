/*
 * The panel's own settings, kept across reloads (M4b devtools decision 8):
 * open or closed, its size, and the corner it's docked in. The panel runs in
 * a worker, which has no `localStorage`, so they live in IndexedDB, the
 * page's origin's like `localStorage` would be. Every read and write is
 * best-effort: without storage (a private window, blocked site data) the
 * panel starts from its defaults and keeps working.
 */
import type { DevtoolsPosition } from './index';

/** What the panel keeps. */
export type UiState = {
  open: boolean;
  width: number;
  height: number;
  position: DevtoolsPosition;
};

const DB = 'isoloop-devtools';
const STORE = 'settings';
const KEY = 'panel';

const POSITIONS: ReadonlySet<string> = new Set([
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
]);

const isPosition = (v: unknown): v is DevtoolsPosition => typeof v === 'string' && POSITIONS.has(v);

/** The stored fields that are well formed; anything else is dropped. */
export function parseUi(v: unknown): Partial<UiState> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Partial<UiState> = {};
  const open: unknown = Reflect.get(v, 'open');
  const width: unknown = Reflect.get(v, 'width');
  const height: unknown = Reflect.get(v, 'height');
  const position: unknown = Reflect.get(v, 'position');
  if (typeof open === 'boolean') out.open = open;
  if (typeof width === 'number' && Number.isFinite(width)) out.width = width;
  if (typeof height === 'number' && Number.isFinite(height)) out.height = height;
  if (isPosition(position)) out.position = position;
  return out;
}

/** Settles with a request's result; rejects on its error. */
const settle = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.addEventListener('success', () => {
      resolve(req.result);
    });
    req.addEventListener('error', () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    });
  });

function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB, 1);
  req.addEventListener('upgradeneeded', () => {
    req.result.createObjectStore(STORE);
  });
  return Promise.race([
    settle(req),
    new Promise<never>((_resolve, reject) => {
      req.addEventListener('blocked', () => {
        reject(new Error('indexedDB.open blocked'));
      });
    }),
  ]);
}

let db: Promise<IDBDatabase> | undefined;
const database = (): Promise<IDBDatabase> => {
  db ??= openDb();
  return db;
};

/** The stored settings, or `{}` when there are none or storage isn't there. */
export async function loadUi(): Promise<Partial<UiState>> {
  try {
    const d = await database();
    const stored: unknown = await settle(
      d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY),
    );
    return parseUi(stored);
  } catch {
    return {};
  }
}

/** Stores the settings; failures are ignored. Resolves once written (or not). */
export async function saveUi(s: UiState): Promise<void> {
  try {
    const d = await database();
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...s }, KEY);
    await new Promise<void>((resolve) => {
      for (const type of ['complete', 'error', 'abort']) {
        tx.addEventListener(type, () => {
          resolve();
        });
      }
    });
  } catch {
    // Storage unavailable: the panel keeps its state for this run only.
  }
}
