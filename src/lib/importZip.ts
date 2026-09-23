import JSZip from 'jszip';
import type { Item, ItemAttributes, ItemStatus } from '../types';
import { ITEM_STATUSES } from '../types';
import { getItem, putBlob, putItems } from './db';
import { newId } from './ids';
import { createThumbnail } from './image';
import { photoPathFor } from './naming';

/**
 * ZIP restore (the counterpart to the export in plan section 6).
 *
 * Reads the `items.json` produced by `buildExportManifest`, re-creates every
 * photo blob in IndexedDB and regenerates the thumbnails, so a backup can be
 * moved to another device/origin (or recovered after browser data was cleared).
 *
 * Purely additive: it never deletes or overwrites existing items.
 */

export const IMPORT_APP_MARKER = 'possessions-tracker';

export interface RestoreResult {
  /** Items written to IndexedDB. */
  items: number;
  /** Photos read out of the archive. */
  photos: number;
  /** Items already present in the library (same id) that were left untouched. */
  duplicates: number;
  /** Entries that could not be restored (missing/unreadable photo). */
  skipped: number;
  errors: string[];
}

/** A manifest entry normalised into something we can rebuild an Item from. */
export interface ParsedManifestEntry {
  /** Original id from the archive; empty when the entry had none. */
  sourceId: string;
  category: string;
  subcategory: string;
  attributes: ItemAttributes;
  description: string;
  confidence: number;
  status: ItemStatus;
  createdAt: number;
  updatedAt: number;
  fileName: string | undefined;
  mimeType: string | undefined;
  /** Path of the photo inside the archive. */
  photoFile: string;
}

/* ------------------------------------------------------------ pure parsing */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Only the four known attribute slots survive, and only as non-empty strings. */
export function normalizeAttributes(value: unknown): ItemAttributes {
  const record = asRecord(value);
  if (!record) return {};
  const attributes: ItemAttributes = {};
  (['color', 'material', 'size', 'brand'] as const).forEach((key) => {
    const text = asString(record[key]).trim();
    if (text) attributes[key] = text;
  });
  return attributes;
}

export function normalizeStatus(value: unknown): ItemStatus {
  const status = asString(value);
  return ITEM_STATUSES.includes(status as ItemStatus) ? (status as ItemStatus) : 'needs_review';
}

/** Normalises one raw manifest entry, or returns null when it is unusable. */
export function normalizeManifestEntry(
  raw: unknown,
  now: number = Date.now(),
): ParsedManifestEntry | null {
  const record = asRecord(raw);
  if (!record) return null;

  const sourceId = asString(record.id).trim();
  const category = asString(record.category).trim();
  const description = asString(record.description).trim();
  if (!sourceId && !category && !description) return null;

  const fileName = asString(record.fileName).trim() || undefined;
  const mimeType = asString(record.mimeType).trim() || undefined;
  const confidence = asNumber(record.confidence) ?? 0;
  const createdAt = asNumber(record.createdAt) ?? now;
  const updatedAt = asNumber(record.updatedAt) ?? createdAt;
  const photoFile =
    asString(record.photoFile).trim() ||
    photoPathFor(sourceId || 'unidentified', mimeType, fileName);

  return {
    sourceId,
    category,
    subcategory: asString(record.subcategory).trim(),
    attributes: normalizeAttributes(record.attributes),
    description,
    confidence: clamp01(confidence),
    status: normalizeStatus(record.status),
    createdAt,
    updatedAt,
    fileName,
    mimeType,
    photoFile,
  };
}

/** Parses and validates the `items.json` payload of an export archive. */
export function parseManifest(json: unknown, now: number = Date.now()): ParsedManifestEntry[] {
  const body = asRecord(json);
  if (!body) throw new Error('items.json does not contain a JSON object');

  const app = asString(body.app);
  if (app && app !== IMPORT_APP_MARKER) {
    throw new Error(`items.json was produced by a different app ("${app}")`);
  }

  const list = body.items;
  if (!Array.isArray(list)) throw new Error('items.json has no "items" array');

  const entries = list
    .map((entry) => normalizeManifestEntry(entry, now))
    .filter((entry): entry is ParsedManifestEntry => entry !== null);

  if (list.length > 0 && entries.length === 0) {
    throw new Error('items.json contained no usable item records');
  }
  return entries;
}

/**
 * Rebuilds an Item record from a manifest entry and freshly minted blob ids.
 *
 * `syncedToNas` is always reset: the photo has to be re-uploaded from this
 * device (the NAS upload is an idempotent PUT, so this is safe).
 */
export function buildItemFromEntry(
  entry: ParsedManifestEntry,
  ids: { id: string; photoBlobId: string; thumbnailBlobId: string },
  now: number = Date.now(),
): Item {
  const item: Item = {
    id: ids.id,
    photoBlobId: ids.photoBlobId,
    thumbnailBlobId: ids.thumbnailBlobId,
    category: entry.category,
    subcategory: entry.subcategory,
    attributes: { ...entry.attributes },
    description: entry.description || entry.category,
    confidence: entry.confidence,
    status: entry.status,
    createdAt: entry.createdAt || now,
    updatedAt: entry.updatedAt || entry.createdAt || now,
    syncedToNas: false,
  };
  if (entry.fileName) item.fileName = entry.fileName;
  if (entry.mimeType) item.mimeType = entry.mimeType;
  return item;
}

/* ----------------------------------------------------------- restore (I/O) */

export interface RestoreOptions {
  /** Injectable clock, mainly for deterministic tests. */
  now?: number;
  /** Injectable thumbnail generator (canvas is unavailable in node/jsdom). */
  makeThumbnail?: (blob: Blob) => Promise<Blob>;
}

/** Reads a ZIP export back into the local library. */
export async function restoreFromZip(
  file: Blob,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const now = options.now ?? Date.now();
  const makeThumbnail = options.makeThumbnail ?? createThumbnail;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('That file is not a readable ZIP archive');
  }

  const manifestFile = zip.file('items.json');
  if (!manifestFile) throw new Error('items.json is missing from the archive');

  let parsed: unknown;
  try {
    parsed = JSON.parse(await manifestFile.async('string'));
  } catch {
    throw new Error('items.json in the archive is not valid JSON');
  }

  const entries = parseManifest(parsed, now);
  const result: RestoreResult = { items: 0, photos: 0, duplicates: 0, skipped: 0, errors: [] };

  for (const entry of entries) {
    const label = entry.description || entry.sourceId || 'unnamed item';
    try {
      // Keep the original id when it is free so re-imports stay idempotent.
      if (entry.sourceId && (await getItem(entry.sourceId))) {
        result.duplicates += 1;
        continue;
      }
      const id = entry.sourceId || newId();

      const photoInArchive = zip.file(entry.photoFile);
      if (!photoInArchive) {
        result.skipped += 1;
        result.errors.push(`${label}: ${entry.photoFile} is missing from the archive`);
        continue;
      }
      const photoBlob = await photoInArchive.async('blob');
      const mimeType = entry.mimeType || photoBlob.type || 'application/octet-stream';

      const photoBlobId = `${id}:photo`;
      const thumbnailBlobId = `${id}:thumb`;
      await putBlob({
        id: photoBlobId,
        blob: photoBlob,
        mime: mimeType,
        size: photoBlob.size,
        name: entry.fileName || entry.photoFile.split('/').pop() || `${id}.bin`,
      });

      // Thumbnails are rebuilt locally; if the format cannot be decoded we fall
      // back to the original so the grid still shows something.
      let thumbBlob: Blob = photoBlob;
      let thumbMime = mimeType;
      try {
        thumbBlob = await makeThumbnail(photoBlob);
        thumbMime = 'image/jpeg';
      } catch {
        result.errors.push(`${label}: thumbnail could not be generated, using the original`);
      }
      await putBlob({
        id: thumbnailBlobId,
        blob: thumbBlob,
        mime: thumbMime,
        size: thumbBlob.size,
        name: `${id}-thumb.jpg`,
      });

      // putItems (not putItem) so the archive's timestamps survive the restore.
      await putItems([buildItemFromEntry(entry, { id, photoBlobId, thumbnailBlobId }, now)]);
      result.items += 1;
      result.photos += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
