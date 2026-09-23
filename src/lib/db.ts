import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, BlobRecord, Item, ItemStatus, NasSettings } from '../types';
import { DEFAULT_SETTINGS } from './constants';

/**
 * IndexedDB layer.
 *
 * This module is deliberately free of any `window`/DOM usage so that it can be
 * imported from both the main thread and the analysis Web Worker (both have
 * access to IndexedDB).
 */

const DB_NAME = 'possessions-tracker';
const DB_VERSION = 1;

interface SettingsRecord {
  key: string;
  value: Partial<AppSettings>;
}

interface TrackerDB extends DBSchema {
  items: {
    key: string;
    value: Item;
    indexes: {
      'by-category': string;
      'by-status': string;
      'by-createdAt': number;
      'by-updatedAt': number;
    };
  };
  blobs: {
    key: string;
    value: BlobRecord;
  };
  settings: {
    key: string;
    value: SettingsRecord;
  };
}

export type TrackerDatabase = IDBPDatabase<TrackerDB>;

let dbPromise: Promise<TrackerDatabase> | null = null;

export function getDB(): Promise<TrackerDatabase> {
  if (!dbPromise) {
    dbPromise = openDB<TrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('items')) {
          const items = db.createObjectStore('items', { keyPath: 'id' });
          items.createIndex('by-category', 'category');
          items.createIndex('by-status', 'status');
          items.createIndex('by-createdAt', 'createdAt');
          items.createIndex('by-updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

/* ------------------------------------------------------------------ items */

export async function listItems(): Promise<Item[]> {
  const db = await getDB();
  const items = await db.getAll('items');
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getItem(id: string): Promise<Item | undefined> {
  const db = await getDB();
  return db.get('items', id);
}

export async function getItemsByStatus(status: ItemStatus): Promise<Item[]> {
  const db = await getDB();
  const items = await db.getAllFromIndex('items', 'by-status', status);
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getQueuedItemIds(): Promise<string[]> {
  const db = await getDB();
  const [queued, analyzing] = await Promise.all([
    db.getAllKeysFromIndex('items', 'by-status', 'queued'),
    db.getAllKeysFromIndex('items', 'by-status', 'analyzing'),
  ]);
  return [...analyzing, ...queued];
}

export async function putItem(item: Item): Promise<Item> {
  const db = await getDB();
  const next: Item = { ...item, updatedAt: Date.now() };
  await db.put('items', next);
  return next;
}

export async function putItems(items: Item[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('items', 'readwrite');
  await Promise.all(items.map((item) => tx.store.put(item)));
  await tx.done;
}

/** Deletes an item together with its photo and thumbnail blobs. */
export async function deleteItem(id: string): Promise<void> {
  const db = await getDB();
  const item = await db.get('items', id);
  const tx = db.transaction(['items', 'blobs'], 'readwrite');
  const itemStore = tx.objectStore('items');
  await itemStore.delete(id);
  if (item) {
    // Several items can share one photo (multi-object detections), so blobs are
    // only removed once nothing references them any more.
    const remaining = await itemStore.getAll();
    const photoInUse = remaining.some((other) => other.photoBlobId === item.photoBlobId);
    const thumbInUse = remaining.some((other) => other.thumbnailBlobId === item.thumbnailBlobId);
    const blobStore = tx.objectStore('blobs');
    if (!photoInUse) await blobStore.delete(item.photoBlobId);
    if (!thumbInUse && item.thumbnailBlobId !== item.photoBlobId) {
      await blobStore.delete(item.thumbnailBlobId);
    }
  }
  await tx.done;
}

/** Deletes every item belonging to one of the given categories. */
export async function deleteCategories(categories: string[]): Promise<number> {
  const db = await getDB();
  const keySets = await Promise.all(
    categories.map((category) => db.getAllKeysFromIndex('items', 'by-category', category)),
  );
  const keys = new Set(keySets.flat());
  for (const key of keys) {
    await deleteItem(key);
  }
  return keys.size;
}

/** Wipes the whole library (items + blobs). */
export async function deleteEverything(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['items', 'blobs'], 'readwrite');
  await tx.objectStore('items').clear();
  await tx.objectStore('blobs').clear();
  await tx.done;
}

/**
 * After a crash/reload items can be stuck in `analyzing`. Reset them to
 * `queued` so the resume-on-open logic picks them up again (plan section 5).
 */
export async function resetInterruptedAnalysis(): Promise<number> {
  const db = await getDB();
  const stuck = await db.getAllFromIndex('items', 'by-status', 'analyzing');
  if (stuck.length === 0) return 0;
  const tx = db.transaction('items', 'readwrite');
  await Promise.all(
    stuck.map((item) =>
      tx.store.put({ ...item, status: 'queued' as ItemStatus, updatedAt: Date.now() }),
    ),
  );
  await tx.done;
  return stuck.length;
}

/* ------------------------------------------------------------------ blobs */

export async function putBlob(record: BlobRecord): Promise<void> {
  const db = await getDB();
  await db.put('blobs', record);
}

export async function getBlob(id: string): Promise<BlobRecord | undefined> {
  const db = await getDB();
  return db.get('blobs', id);
}

export async function getBlobs(ids: string[]): Promise<Map<string, BlobRecord>> {
  const db = await getDB();
  const records = await Promise.all(ids.map((id) => db.get('blobs', id)));
  const map = new Map<string, BlobRecord>();
  records.forEach((record) => {
    if (record) map.set(record.id, record);
  });
  return map;
}

export async function deleteBlob(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('blobs', id);
}

/* --------------------------------------------------------------- settings */

export async function loadSettings(): Promise<AppSettings> {
  const db = await getDB();
  const record = await db.get('settings', 'app');
  const stored = record?.value ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    nas: { ...DEFAULT_SETTINGS.nas, ...(stored.nas ?? {}) },
  };
}

/** Settings can be patched field by field; NAS fields are merged individually. */
export interface SettingsPatch extends Partial<Omit<AppSettings, 'nas'>> {
  nas?: Partial<NasSettings>;
}

export async function saveSettings(patch: SettingsPatch): Promise<AppSettings> {
  const db = await getDB();
  const record = await db.get('settings', 'app');
  const current = record?.value ?? {};
  const next: Partial<AppSettings> = {
    ...current,
    ...(patch as Partial<AppSettings>),
    ...(patch.nas
      ? { nas: { ...DEFAULT_SETTINGS.nas, ...(current.nas ?? {}), ...patch.nas } }
      : {}),
  };
  await db.put('settings', { key: 'app', value: next });
  return loadSettings();
}
